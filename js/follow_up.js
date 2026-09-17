const SUPABASE_URL = 'https://hhotnexzmehphsrnpihb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vlwTA8RfDF_vKdp9GYwHDg_arsusIC-';

function cleanName(name) {
    if (!name) return name;
    return name.replace(/^-\s*/, '').trim();
}

function translatePaymentMethod(method) {
    if (!method) return 'No especificado';
    const translations = { card: 'Tarjeta', transfer: 'Transferencia', cash: 'Efectivo' };
    return translations[method.toLowerCase()] || method;
}

// ============================================================
// LLAMADA A LA RPC DE SUPABASE
// ============================================================
async function consultarOrdenRPC(prefix, number, nip) {
    const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/consultar_orden', {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            folio_prefix: prefix,
            folio_number: number,
            nip: nip
        })
    });

    if (!response.ok) {
        throw new Error('Error al consultar el servidor (Código ' + response.status + ')');
    }
    return await response.json();
}

document.addEventListener('DOMContentLoaded', function () {
    const input = document.getElementById('folioInput');
    const button = document.getElementById('searchBtn');
    const resultDiv = document.getElementById('resultado');

    // ------------------------------------------------------------
    // 1. BUSCAR ORDEN POR FOLIO (valida formato y pide NIP)
    // ------------------------------------------------------------
    function buscarOrden() {
        const folio = input.value.trim();
        if (!folio) {
            resultDiv.innerHTML = '<p class="error">Por favor ingresa un folio.</p>';
            resultDiv.classList.add('visible');
            return;
        }

        const parts = folio.split('-');
        if (parts.length !== 2) {
            resultDiv.innerHTML = '<p class="error">Formato de folio inválido. Debe ser PREFIJO-NÚMERO (ej: TV-12345).</p>';
            resultDiv.classList.add('visible');
            return;
        }

        const prefix = parts[0].toUpperCase();
        const number = parseInt(parts[1]);
        if (isNaN(number)) {
            resultDiv.innerHTML = '<p class="error">El número de folio debe ser un valor numérico.</p>';
            resultDiv.classList.add('visible');
            return;
        }

        mostrarFormularioNIP(folio, prefix, number);
    }

    // ------------------------------------------------------------
    // 2. FORMULARIO DE NIP
    // ------------------------------------------------------------
    function mostrarFormularioNIP(folio, prefix, number) {
        // FIX: faltaba esta línea. Sin ella, el contenedor de resultados
        // se llenaba con el formulario de NIP pero quedaba oculto hasta
        // que una búsqueda anterior con error hubiera agregado 'visible'.
        resultDiv.classList.add('visible');

        resultDiv.innerHTML = `
            <div style="text-align:center; padding: 10px 0;">
                <p style="color: #aaa; margin-bottom:8px;">Ingresa los últimos 4 dígitos de tu teléfono para ver la orden <strong style="color:#fff;">${folio}</strong></p>
            </div>
            <div class="nip-block">
                <div class="input-group-nip">
                    <input type="password" id="nipInput" maxlength="4" placeholder="Ej: 2456" inputmode="numeric" pattern="[0-9]*" />
                    <button id="verificarNipBtn"><i class="fas fa-unlock-alt"></i> Verificar</button>
                </div>
                <div id="nipError" class="nip-error" style="display:none;">NIP incorrecto. Intenta nuevamente.</div>
                <div style="margin-top:10px; font-size:0.8rem; color:#666;">
                    <i class="fas fa-info-circle"></i> El NIP son los últimos 4 dígitos del teléfono registrado.
                </div>
            </div>
        `;

        const nipInput = document.getElementById('nipInput');
        const verificarBtn = document.getElementById('verificarNipBtn');
        const nipError = document.getElementById('nipError');

        nipInput.focus();

        async function verificarNIP() {
            const nip = nipInput.value.trim();
            if (nip.length !== 4 || !/^\d{4}$/.test(nip)) {
                nipError.textContent = 'Ingresa exactamente 4 dígitos.';
                nipError.style.display = 'block';
                return;
            }

            nipError.style.display = 'none';
            resultDiv.innerHTML = '<p><i class="fas fa-spinner fa-spin"></i> Verificando...</p>';

            try {
                const data = await consultarOrdenRPC(prefix, number, nip);

                if (!data || data.error) {
                    const msg = (data && data.error) || 'NIP incorrecto. Intenta nuevamente.';
                    mostrarFormularioNIP(folio, prefix, number);
                    const errEl = document.getElementById('nipError');
                    if (errEl) {
                        errEl.textContent = msg;
                        errEl.style.display = 'block';
                    }
                    return;
                }

                mostrarDetallesOrden(folio, data);

            } catch (err) {
                console.error(err);
                mostrarFormularioNIP(folio, prefix, number);
                const errEl = document.getElementById('nipError');
                if (errEl) {
                    errEl.textContent = 'Error al verificar. Intenta nuevamente.';
                    errEl.style.display = 'block';
                }
            }
        }

        verificarBtn.addEventListener('click', verificarNIP);
        nipInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') verificarNIP();
        });
        nipInput.addEventListener('input', function () {
            this.value = this.value.replace(/\D/g, '').slice(0, 4);
        });
    }

    // ------------------------------------------------------------
    // 3. MOSTRAR DETALLES (ya vienen completos desde la RPC)
    // ------------------------------------------------------------
    function mostrarDetallesOrden(folio, data) {
        resultDiv.classList.add('visible');

        const orden = data.orden;
        const servicios = data.servicios || [];
        const imagenes = data.imagenes || [];
        const pagos = data.pagos || [];

        // Artículos
        let articulosHtml = '';
        if (servicios.length > 0) {
            const totalArticulos = servicios.reduce((sum, s) => sum + (parseInt(s.quantity) || 0), 0);
            articulosHtml = `
                <div style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.05);">
                    <p style="color:#aaa; font-weight:600; margin-bottom:6px;">
                        <i class="fas fa-boxes"></i> Artículos en reparación (${servicios.length})
                    </p>
                    <div style="overflow-x:auto; border-radius:8px; border:1px solid rgba(19,178,251,0.15);">
                        <table style="width:100%; border-collapse:collapse; background:rgba(10,25,47,0.4);">
                            <thead>
                                <tr style="background:rgba(19,178,251,0.1); color:#fff;">
                                    <th style="padding:8px 12px; text-align:left; font-size:0.8rem;">Artículo</th>
                                    <th style="padding:8px 12px; text-align:center; font-size:0.8rem;">Cantidad</th>
                                    <th style="padding:8px 12px; text-align:left; font-size:0.8rem;">Falla</th>
                                    <th style="padding:8px 12px; text-align:center; font-size:0.8rem;">Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${servicios.map(s => `
                                    <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                        <td style="padding:8px 12px; color:#fff; font-size:0.9rem;">#${s.article_id || 'N/A'}</td>
                                        <td style="padding:8px 12px; color:#fff; text-align:center; font-size:0.9rem;">${s.quantity || 1}</td>
                                        <td style="padding:8px 12px; color:#ccc; font-size:0.85rem;">${s.falla_principal || 'No especificada'}</td>
                                        <td style="padding:8px 12px; text-align:center; font-size:0.8rem;">
                                            <span style="display:inline-block; padding:2px 10px; border-radius:12px; background:rgba(19,178,251,0.15); color:#13B2FB; border:1px solid rgba(19,178,251,0.3);">${s.status || 'recibido'}</span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:10px; padding:8px 16px; background:rgba(19,178,251,0.05); border-radius:6px;">
                        <span style="color:#aaa;">Total de artículos:</span>
                        <span style="color:#fff; font-weight:600;">${totalArticulos}</span>
                    </div>
                </div>
            `;
        } else {
            articulosHtml = '<p style="color:#888; margin-top:12px;"><i class="fas fa-info-circle"></i> No hay artículos registrados para esta orden.</p>';
        }

        // Imágenes
        let imagesHtml = '';
        if (imagenes.length > 0) {
            imagesHtml = `
                <div style="margin-top:16px;">
                    <p style="color:#aaa; font-weight:600; margin-bottom:8px;">
                        <i class="fas fa-images"></i> Imágenes del servicio
                    </p>
                    <div class="imagenes-grid">
                        ${imagenes.map(img => `
                            <a href="${img.image_url}" target="_blank">
                                <img src="${img.image_url}" alt="Imagen del servicio" loading="lazy" />
                            </a>
                        `).join('')}
                    </div>
                </div>
            `;
        } else {
            imagesHtml = '<p style="color:#666; margin-top:12px;"><i class="fas fa-info-circle"></i> Este servicio no tiene imágenes registradas.</p>';
        }

        // Pagos
        let paymentsHtml = '';
        if (pagos.length > 0) {
            paymentsHtml = `
                <div style="margin-top:16px; border-top:1px solid rgba(255,255,255,0.05); padding-top:16px;">
                    <p style="color:#aaa; font-weight:600; margin-bottom:8px;">
                        <i class="fas fa-coins"></i> Pagos realizados (${pagos.length})
                    </p>
                    <div style="overflow-x:auto; border-radius:8px; border:1px solid rgba(19,178,251,0.15);">
                        <table style="width:100%; border-collapse:collapse; background:rgba(10,25,47,0.4);">
                            <thead>
                                <tr style="background:rgba(19,178,251,0.1); color:#fff;">
                                    <th style="padding:8px 12px; text-align:left; font-size:0.8rem;">Fecha</th>
                                    <th style="padding:8px 12px; text-align:left; font-size:0.8rem;">Monto</th>
                                    <th style="padding:8px 12px; text-align:left; font-size:0.8rem;">Método</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${pagos.map(p => `
                                    <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                        <td style="padding:8px 12px; color:#ccc; font-size:0.9rem;">${new Date(p.payment_date).toLocaleDateString('es-MX')}</td>
                                        <td style="padding:8px 12px; color:#fff; font-size:0.9rem; font-weight:600;">$${Number(p.amount).toFixed(2)}</td>
                                        <td style="padding:8px 12px; color:#ccc; font-size:0.9rem;">${translatePaymentMethod(p.payment_method)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:12px; padding:10px 16px; background:rgba(19,178,251,0.05); border-radius:8px;">
                        <span style="color:#aaa;">Total pagado:</span>
                        <span style="color:#4CAF50; font-weight:700;">$${Number(data.total_pagado).toFixed(2)}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:6px; padding:10px 16px; background:rgba(19,178,251,0.08); border-radius:8px;">
                        <span style="color:#aaa;">Saldo pendiente:</span>
                        <span style="color:${data.saldo > 0 ? '#FF9800' : '#4CAF50'}; font-weight:700;">$${Number(data.saldo).toFixed(2)}</span>
                    </div>
                </div>
            `;
        } else {
            paymentsHtml = '<p style="color:#888; margin-top:12px;"><i class="fas fa-info-circle"></i> No hay pagos registrados para esta orden.</p>';
        }

        const fecha = orden.order_date
            ? new Date(orden.order_date).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
            : 'No registrada';

        const total = orden.total_amount !== null && orden.total_amount !== undefined
            ? '$' + Number(orden.total_amount).toFixed(2)
            : 'Pendiente';

        resultDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h3 style="color:#fff; font-family: var(--font-primary); margin:0;">Orden: ${folio}</h3>
                <span style="font-size:0.8rem; color:#666;">
                    <i class="fas fa-lock" style="color:var(--cyan-tech);"></i> Verificado
                </span>
            </div>
            <div class="orden-info">
                <span class="label">Cliente:</span>
                <span class="valor">${cleanName(orden.client_name)}</span>
                <span class="label">Teléfono:</span>
                <span class="valor">${orden.client_telephone || 'No registrado'}</span>
                <span class="label">Tipo de artículo:</span>
                <span class="valor">${orden.article_type_name || 'Artículo no especificado'}</span>
                <span class="label">Fecha de ingreso:</span>
                <span class="valor">${fecha}</span>
                <span class="label">Monto total:</span>
                <span class="valor">${total}</span>
            </div>
            ${articulosHtml}
            ${paymentsHtml}
            ${imagesHtml}
            <p style="margin-top:20px; font-size:0.9rem; color:#888; border-top:1px solid rgba(255,255,255,0.05); padding-top:16px;">
                <i class="fas fa-info-circle"></i> Si requieres más información, contáctanos al 772 164 6924.
            </p>
        `;

        resultDiv.classList.add('visible');
        resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ------------------------------------------------------------
    // 4. EVENTOS
    // ------------------------------------------------------------
    button.addEventListener('click', buscarOrden);
    input.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') buscarOrden();
    });

    const params = new URLSearchParams(window.location.search);
    const folioParam = params.get('folio');
    if (folioParam) {
        input.value = folioParam;
        buscarOrden();
    }
});
