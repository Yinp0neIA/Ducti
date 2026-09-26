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
// SEGURIDAD DE LA VISTA: escapar HTML y limitar URLs
// Todo lo que viene de la base de datos se interpola en innerHTML,
// así que se escapa siempre antes de insertarlo (evita que un campo
// con "<" ">" '"' etc. rompa el HTML o inyecte algo). Las URLs de
// imagen solo se aceptan si son http(s) o relativas: nunca
// "javascript:" u otros esquemas.
// ============================================================
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeUrl(url) {
    if (!url) return '#';
    const s = String(url).trim();
    if (/^https?:\/\//i.test(s) || /^\.{0,2}\//.test(s)) {
        return escapeHtml(s);
    }
    return '#';
}

// ============================================================
// PRIVACIDAD: mostrar menos datos del cliente en pantalla.
// El folio + NIP ya prueban que quien consulta conoce el teléfono
// registrado; no hace falta repetirle el nombre completo ni el
// teléfono completo de vuelta. Se muestra solo lo necesario para
// confirmar "sí, esta es tu orden".
// ============================================================
function maskName(name) {
    const clean = cleanName(name);
    if (!clean) return 'Cliente';
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'Cliente';
    const first = parts[0];
    const initials = parts.slice(1)
        .map(p => p.charAt(0).toUpperCase() + '.')
        .join(' ');
    return initials ? (first + ' ' + initials) : first;
}

function maskPhone(phone) {
    if (!phone) return 'No registrado';
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 4) return '••••';
    return '•••• •• ' + digits.slice(-4);
}

// Traduce el status de la base a una insignia de color, con
// coincidencia flexible ya que no controlamos el texto exacto que
// llega. Si no reconoce la palabra, usa el estilo neutro por defecto.
function statusInfo(rawStatus) {
    const status = (rawStatus || 'Recibido').toString();
    const lower = status.toLowerCase();
    let modifier = '';
    if (/entreg/.test(lower)) modifier = 'entregado';
    else if (/listo|termin|complet/.test(lower)) modifier = 'listo';
    else if (/repara/.test(lower)) modifier = 'reparacion';
    else if (/diagn/.test(lower)) modifier = 'diagnostico';
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return { modifier, label };
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

    // Cuenta los NIP incorrectos seguidos para el mismo folio, para
    // aplicar una pequeña espera creciente. IMPORTANTE: esto es solo
    // una fricción del lado del cliente para desalentar que alguien
    // pruebe NIPs a mano; no sustituye un límite real del lado del
    // servidor (cualquiera puede llamar la función de Supabase
    // directamente sin pasar por esta página). Ese límite debe vivir
    // en la función `consultar_orden` o en una política de Supabase.
    let failedAttempts = 0;

    // ------------------------------------------------------------
    // 1. BUSCAR ORDEN POR FOLIO (valida formato y pide NIP)
    // ------------------------------------------------------------
    function buscarOrden() {
        failedAttempts = 0;
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
    // 2. FORMULARIO DE NIP (con espera tras varios intentos fallidos)
    // ------------------------------------------------------------
    function mostrarFormularioNIP(folio, prefix, number) {
        resultDiv.classList.add('visible');

        const cooldownSeconds = failedAttempts >= 3
            ? Math.min(5 * (failedAttempts - 2), 20)
            : 0;

        resultDiv.innerHTML = `
            <div style="text-align:center; padding: 10px 0;">
                <p style="color: #aaa; margin-bottom:8px;">Ingresa los últimos 4 dígitos de tu teléfono para ver la orden <strong style="color:#fff;">${escapeHtml(folio)}</strong></p>
            </div>
            <div class="nip-block">
                <div class="input-group-nip">
                    <input type="password" id="nipInput" maxlength="4" placeholder="Ej: 2456" inputmode="numeric" pattern="[0-9]*" ${cooldownSeconds ? 'disabled' : ''} />
                    <button id="verificarNipBtn" ${cooldownSeconds ? 'disabled' : ''}><i class="fas fa-unlock-alt"></i> Verificar</button>
                </div>
                <div id="nipError" class="nip-error" style="display:none;"></div>
                ${cooldownSeconds ? `
                <div id="nipCooldown" class="nip-cooldown">
                    <i class="fas fa-hourglass-half"></i>
                    Demasiados intentos. Espera <span id="nipCooldownCount">${cooldownSeconds}</span>s e inténtalo de nuevo.
                </div>` : ''}
                <div style="margin-top:10px; font-size:0.8rem; color:#666;">
                    <i class="fas fa-info-circle"></i> El NIP son los últimos 4 dígitos del teléfono registrado.
                </div>
            </div>
        `;

        const nipInput = document.getElementById('nipInput');
        const verificarBtn = document.getElementById('verificarNipBtn');
        const nipError = document.getElementById('nipError');

        if (cooldownSeconds) {
            let remaining = cooldownSeconds;
            const countEl = document.getElementById('nipCooldownCount');
            const cooldownBox = document.getElementById('nipCooldown');
            const interval = setInterval(function () {
                remaining -= 1;
                if (countEl) countEl.textContent = remaining;
                if (remaining <= 0) {
                    clearInterval(interval);
                    nipInput.disabled = false;
                    verificarBtn.disabled = false;
                    if (cooldownBox) cooldownBox.style.display = 'none';
                    nipInput.focus();
                }
            }, 1000);
        } else {
            nipInput.focus();
        }

        async function verificarNIP() {
            if (nipInput.disabled) return;

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
                    failedAttempts++;
                    const msg = (data && data.error) || 'NIP incorrecto. Intenta nuevamente.';
                    mostrarFormularioNIP(folio, prefix, number);
                    const errEl = document.getElementById('nipError');
                    if (errEl) {
                        errEl.textContent = msg;
                        errEl.style.display = 'block';
                    }
                    return;
                }

                failedAttempts = 0;
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
                <div class="orden-bloque">
                    <p class="orden-bloque-titulo"><i class="fas fa-boxes"></i> Artículos en reparación (${servicios.length})</p>
                    <div class="orden-tabla-wrap">
                        <table class="orden-tabla">
                            <thead>
                                <tr>
                                    <th>Artículo</th>
                                    <th class="centrado">Cantidad</th>
                                    <th>Falla</th>
                                    <th class="centrado">Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${servicios.map(s => {
                                    const info = statusInfo(s.status);
                                    return `
                                    <tr>
                                        <td>#${escapeHtml(s.article_id || 'N/A')}</td>
                                        <td class="centrado">${escapeHtml(s.quantity || 1)}</td>
                                        <td>${escapeHtml(s.falla_principal || 'No especificada')}</td>
                                        <td class="centrado">
                                            <span class="estado-badge${info.modifier ? ' estado-badge--' + info.modifier : ''}">${escapeHtml(info.label)}</span>
                                        </td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="orden-resumen-fila">
                        <span>Total de artículos:</span>
                        <span class="valor-fuerte">${escapeHtml(totalArticulos)}</span>
                    </div>
                </div>
            `;
        } else {
            articulosHtml = '<p class="orden-vacio"><i class="fas fa-info-circle"></i> No hay artículos registrados para esta orden.</p>';
        }

        // Imágenes
        let imagesHtml = '';
        if (imagenes.length > 0) {
            imagesHtml = `
                <div class="orden-bloque">
                    <p class="orden-bloque-titulo"><i class="fas fa-images"></i> Imágenes del servicio</p>
                    <div class="imagenes-grid">
                        ${imagenes.map(img => `
                            <a href="${safeUrl(img.image_url)}" target="_blank" rel="noopener noreferrer">
                                <img src="${safeUrl(img.image_url)}" alt="Imagen del servicio" loading="lazy" />
                            </a>
                        `).join('')}
                    </div>
                </div>
            `;
        } else {
            imagesHtml = '<p class="orden-vacio"><i class="fas fa-info-circle"></i> Este servicio no tiene imágenes registradas.</p>';
        }

        // Pagos
        let paymentsHtml = '';
        if (pagos.length > 0) {
            paymentsHtml = `
                <div class="orden-bloque">
                    <p class="orden-bloque-titulo"><i class="fas fa-coins"></i> Pagos realizados (${pagos.length})</p>
                    <div class="orden-tabla-wrap">
                        <table class="orden-tabla">
                            <thead>
                                <tr><th>Fecha</th><th>Monto</th><th>Método</th></tr>
                            </thead>
                            <tbody>
                                ${pagos.map(p => `
                                    <tr>
                                        <td>${escapeHtml(new Date(p.payment_date).toLocaleDateString('es-MX'))}</td>
                                        <td><strong>$${escapeHtml(Number(p.amount).toFixed(2))}</strong></td>
                                        <td>${escapeHtml(translatePaymentMethod(p.payment_method))}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="orden-resumen-fila pagado">
                        <span>Total pagado:</span>
                        <span class="valor-fuerte">$${escapeHtml(Number(data.total_pagado).toFixed(2))}</span>
                    </div>
                    <div class="orden-resumen-fila saldo">
                        <span>Saldo pendiente:</span>
                        <span class="valor-fuerte ${data.saldo > 0 ? 'pendiente' : 'saldado'}">$${escapeHtml(Number(data.saldo).toFixed(2))}</span>
                    </div>
                </div>
            `;
        } else {
            paymentsHtml = '<p class="orden-vacio"><i class="fas fa-info-circle"></i> No hay pagos registrados para esta orden.</p>';
        }

        const fecha = orden.order_date
            ? new Date(orden.order_date).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
            : 'No registrada';

        const total = orden.total_amount !== null && orden.total_amount !== undefined
            ? '$' + Number(orden.total_amount).toFixed(2)
            : 'Pendiente';

        resultDiv.innerHTML = `
            <div class="orden-header">
                <h3>Orden: ${escapeHtml(folio)}</h3>
                <span class="orden-verificado"><i class="fas fa-lock"></i> Verificado</span>
            </div>
            <div class="orden-info">
                <span class="label">Cliente:</span>
                <span class="valor">${escapeHtml(maskName(orden.client_name))}</span>
                <span class="label">Teléfono:</span>
                <span class="valor">${escapeHtml(maskPhone(orden.client_telephone))}</span>
                <span class="label">Tipo de artículo:</span>
                <span class="valor">${escapeHtml(orden.article_type_name || 'Artículo no especificado')}</span>
                <span class="label">Fecha de ingreso:</span>
                <span class="valor">${escapeHtml(fecha)}</span>
                <span class="label">Monto total:</span>
                <span class="valor">${escapeHtml(total)}</span>
            </div>
            ${articulosHtml}
            ${paymentsHtml}
            ${imagesHtml}
            <p class="orden-nota-final">
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