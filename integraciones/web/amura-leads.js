/*
 * AMURA · conector de la página web con AMURA (captación de leads por la función leads-web).
 *
 *   <script src="/js/amura-leads.js" defer
 *     data-whatsapp="5939XXXXXXXX"
 *     data-politica="https://…/politica-de-privacidad"
 *     data-responsable="[RAZÓN SOCIAL]" data-correo-datos="[CORREO DE PROTECCIÓN DE DATOS]"></script>
 *
 * - Formularios: conecta los marcados con data-amura-lead="nombre-del-formulario" (o con la clase amura-lead). Cada envío
 *   llega a AMURA como prospecto, con el formulario, la página y la campaña (UTM) de procedencia; la persona ve la confirmación.
 * - WhatsApp: antes de abrir un enlace a wa.me o api.whatsapp.com (o #amura-whatsapp) pide nombre, celular y consentimiento.
 * - Si el formulario no tiene casilla de consentimiento, la agrega; también agrega un campo trampa contra programas.
 * Guía: integraciones/web/README.md
 */
(function () {
  'use strict';
  if (window.AmuraLeads) return;

  // ---- Configuración: atributos data-* de esta etiqueta <script> o window.AMURA_LEADS ------------------------------------
  var script = document.currentScript;
  var atributos = {};
  if (script) for (var clave in script.dataset) atributos[clave] = script.dataset[clave];
  var cfg = Object.assign({
    endpoint: 'https://sjjjlnqgcaqtkmzdcmog.supabase.co/functions/v1/leads-web',
    whatsapp: '',               // número de AMURA en formato internacional, sin + (si falta, el del enlace)
    version: 'v1-2026-11',      // versión aprobada del texto de consentimiento
    politica: '#',              // URL pública de la política de privacidad
    responsable: '[RAZÓN SOCIAL DE NUVAREL]',
    correoDatos: '[CORREO DE PROTECCIÓN DE DATOS]',
    gracias: '',                // página de agradecimiento opcional (o data-amura-gracias en cada formulario)
    mensajeWhatsapp: 'Hola, soy {nombre}. Quiero información de AMURA Apartments.'
  }, atributos, window.AMURA_LEADS || {});

  var INICIO = Date.now();
  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var CLAVE_VISITA = 'amura-leads-visita';
  var FORMULARIOS = 'form[data-amura-lead], form.amura-lead, [data-amura-lead] form, .amura-lead form';
  var WHATSAPP = 'a[href*="wa.me/"], a[href*="api.whatsapp.com/"], a[href*="web.whatsapp.com/"], a[href^="whatsapp:"], a[href="#amura-whatsapp"], [data-amura-whatsapp]';
  var CELULAR = /^\+?[0-9][0-9 ()-]{6,24}$/;
  var CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var CONSENTIMIENTO = /(consentimiento|autorizo|acepto|privacidad|politica de|tratamiento)/;
  // Cómo se reconoce cada campo cuando no lleva data-amura-campo: su tipo, su nombre, su etiqueta o su texto de ayuda.
  var REGLAS = [
    ['email', function (c, k) { return c.type === 'email' || /(e-?mail|correo)/.test(k); }],
    ['celular', function (c, k) { return c.type === 'tel' || /(celular|telefono|phone|movil|mobile|whatsapp|(^|[^a-z])tel([^a-z]|$))/.test(k); }],
    ['apellido', function (c, k) { return /(apellido|last.?name|surname)/.test(k); }],
    ['nombre', function (c, k) { return /(^|[^a-z])(nombres?|name|full.?name)([^a-z]|$)/.test(k) && !/(empresa|company|compania|usuario|user)/.test(k); }],
    ['presupuesto', function (c, k) { return /(presupuesto|budget)/.test(k); }],
    ['unidad', function (c, k) { return /(departamento|unidad|tipologia)/.test(k); }],
    ['mensaje', function (c, k) { return c.tagName === 'TEXTAREA' || /(mensaje|message|comentario|consulta|pregunta)/.test(k); }]
  ];

  function el(etiqueta, clase) {
    var e = document.createElement(etiqueta);
    if (clase) e.className = clase;
    return e;
  }
  function normal(v) {
    var s = String(v || '').toLowerCase();
    return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
  }
  function slug(v) { return normal(v).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
  function limpiar(t) { return String(t || '').replace(/[*:]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120); }
  /** form_fields[celular] → celular (Elementor y otros constructores). */
  function interno(nombre) { return String(nombre || '').replace(/^.*\[([^\]]+)\]$/, '$1'); }

  // ---- Procedencia: la campaña y la página de entrada se guardan al llegar y se conservan al navegar ----------------------
  function referenteExterno() {
    try {
      var r = new URL(document.referrer);
      return r.origin === location.origin ? '' : r.origin;
    } catch { return ''; }
  }
  function procedencia() {
    var q = new URLSearchParams(location.search), utm = {}, hay = false, guardada = null;
    UTM.forEach(function (k) { var v = q.get(k); if (v) { utm[k] = v.slice(0, 200); hay = true; } });
    try { guardada = JSON.parse(sessionStorage.getItem(CLAVE_VISITA) || 'null'); } catch { guardada = null; }
    if (guardada && !hay) return guardada;
    var visita = Object.assign({ landing: location.origin + location.pathname, referrer: referenteExterno() }, utm);
    try { sessionStorage.setItem(CLAVE_VISITA, JSON.stringify(visita)); } catch { /* sin almacenamiento: vale la página actual */ }
    return visita;
  }

  // ---- Campos del formulario ------------------------------------------------------------------------------------------
  function textoEtiqueta(c) {
    if (c.labels && c.labels.length) return c.labels[0].textContent;
    var l = c.closest('label');
    return l ? l.textContent : '';
  }
  function claves(c) {
    return normal([interno(c.name), c.id, c.getAttribute('aria-label'), c.getAttribute('placeholder'), textoEtiqueta(c)].join(' '));
  }
  function controles(form) {
    return Array.prototype.filter.call(form.elements, function (c) {
      return /^(INPUT|TEXTAREA|SELECT)$/.test(c.tagName) && !c.disabled && !c.hasAttribute('data-amura-trampa') &&
        !/^(submit|button|reset|image|file|password|hidden)$/.test(c.type);
    });
  }
  /** Qué control es el nombre, el celular, el correo…: primero data-amura-campo; después el tipo, el nombre o la etiqueta. */
  function campos(form) {
    var lista = controles(form), usados = [], m = {};
    function tomar(campo, c) { m[campo] = c; usados.push(c); }
    function libre(c) { return usados.indexOf(c) < 0; }
    lista.forEach(function (c) { var x = c.getAttribute('data-amura-campo'); if (x && !m[x]) tomar(x, c); });
    if (!m.consentimiento) {
      var caja = lista.filter(function (c) { return libre(c) && c.type === 'checkbox' && CONSENTIMIENTO.test(claves(c)); })[0];
      if (caja) tomar('consentimiento', caja);
    }
    REGLAS.forEach(function (regla) {
      if (m[regla[0]]) return;
      var c = lista.filter(function (x) { return libre(x) && x.type !== 'checkbox' && x.type !== 'radio' && regla[1](x, claves(x)); })[0];
      if (c) tomar(regla[0], c);
    });
    m.extras = lista.filter(libre);
    return m;
  }
  function valor(c) {
    if (c.tagName === 'SELECT') {
      return Array.prototype.filter.call(c.options, function (o) { return o.selected && o.value; })
        .map(function (o) { return o.text.trim(); }).join(', ');
    }
    if (c.type === 'checkbox' || c.type === 'radio') return c.checked ? (limpiar(textoEtiqueta(c)) || c.value) : '';
    return String(c.value || '').trim();
  }
  function etiqueta(c) {
    var opcion = c.type === 'checkbox' || c.type === 'radio';
    var grupo = opcion && c.closest('fieldset');
    var leyenda = grupo && grupo.querySelector('legend');
    if (leyenda) return limpiar(leyenda.textContent);
    if (opcion) return limpiar(interno(c.name));
    return limpiar(textoEtiqueta(c) || c.getAttribute('aria-label') || c.getAttribute('placeholder') || interno(c.name));
  }
  /** Lo que se envía a AMURA. Las preguntas que AMURA no reconoce van al mensaje, con su etiqueta: nada se pierde. */
  function datos(form) {
    var m = campos(form);
    function v(campo) { return m[campo] ? valor(m[campo]) : ''; }
    var extras = m.extras.map(function (c) { var x = valor(c); return x ? etiqueta(c) + ': ' + x : ''; }).filter(Boolean);
    var trampa = form.querySelector('[data-amura-trampa]');
    return {
      nombre: [v('nombre'), v('apellido')].filter(Boolean).join(' '),
      celular: v('celular'),
      email: v('email'),
      mensaje: [v('mensaje')].concat(extras).filter(Boolean).join('\n').slice(0, 2000),
      unidad: v('unidad'),
      presupuesto: v('presupuesto'),
      consentimiento: !!(m.consentimiento && m.consentimiento.checked),
      empresa: trampa ? trampa.value : ''
    };
  }
  function validar(d) {
    if (d.nombre.trim().length < 3) return 'Ingresa tu nombre completo.';
    if (!CELULAR.test(d.celular.trim())) return 'Ingresa un celular válido: 09XXXXXXXX o con + y el código de tu país.';
    if (d.email && !CORREO.test(d.email.trim())) return 'El correo no es válido.';
    if (!d.consentimiento) return 'Para continuar, acepta el tratamiento de tus datos personales.';
    return '';
  }

  // ---- Lo que el conector agrega al formulario --------------------------------------------------------------------------
  /** Antes del botón de envío (o de su contenedor, si el botón va solo en él). */
  function insertar(form, nodo) {
    var antes = form.querySelector('[type=submit], button:not([type])');
    if (!antes) return form.appendChild(nodo);
    while (antes.parentNode !== form && antes.parentNode.children.length === 1) antes = antes.parentNode;
    antes.parentNode.insertBefore(nodo, antes);
  }
  function casillaConsentimiento() {
    var label = el('label', 'amura-lw-consentimiento');
    var caja = el('input');
    caja.type = 'checkbox';
    caja.name = 'amura_consentimiento';
    caja.setAttribute('data-amura-campo', 'consentimiento');
    var texto = el('span');
    texto.appendChild(document.createTextNode('Autorizo a ' + cfg.responsable + ' a tratar mis datos personales (nombre, celular, correo y mi consulta) ' +
      'para contactarme y enviarme información comercial sobre el proyecto AMURA Apartments, y dar seguimiento a mi solicitud. ' +
      'Puedo revocar esta autorización y ejercer mis derechos en cualquier momento escribiendo a ' + cfg.correoDatos + '. Conoce más en la '));
    var a = el('a');
    a.href = cfg.politica;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Política de Privacidad';
    texto.appendChild(a);
    texto.appendChild(document.createTextNode('.'));
    label.appendChild(caja);
    label.appendChild(texto);
    return label;
  }
  function campoTrampa() {
    // Las personas no lo ven; los programas que llenan todo, sí: AMURA descarta esos envíos.
    var label = el('label', 'amura-lw-trampa');
    label.setAttribute('aria-hidden', 'true');
    label.appendChild(document.createTextNode('Empresa'));
    var i = el('input');
    i.name = 'amura_empresa';
    i.tabIndex = -1;
    i.setAttribute('autocomplete', 'off');
    i.setAttribute('data-amura-trampa', '');
    label.appendChild(i);
    return label;
  }
  function estado(form) {
    var e = form.querySelector('[data-amura-estado]');
    if (!e) {
      e = el('div', 'amura-lw-estado');
      e.setAttribute('data-amura-estado', '');
      e.setAttribute('role', 'status');
      e.setAttribute('aria-live', 'polite');
      e.hidden = true;
      insertar(form, e);
    }
    return e;
  }
  function mostrar(aviso, texto, tipo, url, textoEnlace) {
    aviso.hidden = false;
    aviso.classList.add('amura-lw-estado');
    aviso.setAttribute('data-tipo', tipo);
    aviso.textContent = texto;
    if (url) {
      var a = el('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = textoEnlace;
      aviso.appendChild(document.createTextNode(' '));
      aviso.appendChild(a);
    }
  }
  function preparar(form) {
    if (form.hasAttribute('data-amura-listo')) return;
    form.setAttribute('data-amura-listo', '');
    if (!form.querySelector('[data-amura-trampa]')) form.appendChild(campoTrampa());
    if (!campos(form).consentimiento) insertar(form, casillaConsentimiento());
  }

  // ---- Envío a AMURA --------------------------------------------------------------------------------------------------
  function enviar(d, formulario) {
    var cuerpo = Object.assign({}, procedencia(), d, {
      consentimiento: true,
      consentimiento_version: cfg.version,
      formulario: formulario,
      t: Date.now() - INICIO,
      pagina: location.origin + location.pathname
    });
    return fetch(cfg.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.ok) return j;
          var e = new Error(j.error || 'No pudimos registrar tus datos. Inténtalo de nuevo.');
          e.corregible = r.status === 400;
          throw e;
        });
      }, function () { throw new Error('Sin conexión. Revisa tu internet e inténtalo otra vez.'); });
  }
  function primerNombre(nombre) { return nombre.trim().split(/\s+/)[0]; }
  function bloquear(form, si) {
    Array.prototype.forEach.call(form.querySelectorAll('[type=submit], button:not([type])'), function (b) { b.disabled = si; });
  }
  /** Para la analítica de la página (p. ej. el evento Lead del píxel de Meta): document.addEventListener('amura:lead', …). */
  function avisarSitio(form, formulario) {
    form.dispatchEvent(new CustomEvent('amura:lead', { bubbles: true, detail: { formulario: formulario } }));
  }
  function nombreFormulario(form) {
    var marca = form.closest('[data-amura-lead]');
    return slug((marca && marca.getAttribute('data-amura-lead')) || form.getAttribute('name') || form.id) || 'contacto';
  }

  function alEnviar(e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM' || !form.matches(FORMULARIOS)) return;
    // AMURA atiende el envío: el envío propio del sitio (correo, otro sistema) no corre.
    e.preventDefault();
    e.stopImmediatePropagation();
    preparar(form);
    var aviso = estado(form);
    var d = datos(form);
    var error = validar(d);
    if (error) return mostrar(aviso, error, 'error');
    var formulario = nombreFormulario(form);
    bloquear(form, true);
    mostrar(aviso, 'Enviando…', 'info');
    enviar(d, formulario).then(function () {
      form.reset();
      mostrar(aviso, '¡Gracias, ' + primerNombre(d.nombre) + '! Recibimos tus datos. Un asesor de AMURA te contactará pronto.', 'ok');
      avisarSitio(form, formulario);
      var gracias = form.getAttribute('data-amura-gracias') || cfg.gracias;
      if (gracias) location.assign(gracias);
    }, function (err) {
      mostrar(aviso, err.message, 'error');
    }).then(function () { bloquear(form, false); });
  }

  // ---- Captura previa al botón de WhatsApp ----------------------------------------------------------------------------
  var ventana = null, enlaceWhatsApp = null, foco = null;

  function numeroWhatsApp() {
    var propio = String(cfg.whatsapp || '').replace(/\D/g, '');
    if (propio) return propio;
    var href = enlaceWhatsApp ? (enlaceWhatsApp.getAttribute('href') || '') + ' ' + (enlaceWhatsApp.getAttribute('data-amura-whatsapp') || '') : '';
    var m = href.match(/wa\.me\/(\d{6,15})/) || href.match(/phone=(\d{6,15})/) || href.match(/(?:^|\s)\+?(\d{6,15})(?:\s|$)/);
    return m ? m[1] : '';
  }
  function crearVentana() {
    var fondo = el('div', 'amura-lw-fondo');
    fondo.hidden = true;
    var caja = el('div', 'amura-lw-dialogo');
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-modal', 'true');
    caja.setAttribute('aria-labelledby', 'amura-lw-titulo');
    caja.innerHTML =
      '<button type="button" class="amura-lw-cerrar" aria-label="Cerrar">×</button>' +
      '<form novalidate>' +
      '<h2 id="amura-lw-titulo">Conversemos por WhatsApp</h2>' +
      '<p>Déjanos tu nombre y tu celular para que un asesor de AMURA te atienda.</p>' +
      '<label>Nombre completo<input data-amura-campo="nombre" autocomplete="name" maxlength="120" required></label>' +
      '<label>Celular<input data-amura-campo="celular" type="tel" autocomplete="tel" placeholder="09XXXXXXXX" maxlength="25" required></label>' +
      '<button type="submit" class="amura-lw-boton">Continuar a WhatsApp</button>' +
      '</form>';
    fondo.appendChild(caja);
    document.body.appendChild(fondo);
    var form = caja.querySelector('form');
    preparar(form);
    form.addEventListener('submit', alEnviarWhatsApp);
    caja.querySelector('.amura-lw-cerrar').addEventListener('click', cerrarWhatsApp);
    fondo.addEventListener('click', function (e) { if (e.target === fondo) cerrarWhatsApp(); });
    return fondo;
  }
  function abrirWhatsApp(enlace) {
    enlaceWhatsApp = enlace || null;
    foco = document.activeElement;
    if (!ventana) ventana = crearVentana();
    var form = ventana.querySelector('form');
    estado(form).hidden = true;
    ventana.hidden = false;
    form.querySelector('input').focus();
  }
  function cerrarWhatsApp() {
    if (!ventana || ventana.hidden) return;
    ventana.hidden = true;
    if (foco && foco.focus) foco.focus();
  }
  function alEnviarWhatsApp(e) {
    e.preventDefault();
    var form = e.target;
    var aviso = estado(form);
    var d = datos(form);
    var error = validar(d);
    if (error) return mostrar(aviso, error, 'error');
    var numero = numeroWhatsApp();
    if (!numero) return mostrar(aviso, 'El WhatsApp de AMURA no está configurado en esta página.', 'error');
    var url = 'https://wa.me/' + numero + '?text=' + encodeURIComponent(cfg.mensajeWhatsapp.replace('{nombre}', d.nombre.trim()));
    // La pestaña se abre ya, dentro del clic: si se abre después de esperar la respuesta, el navegador la bloquea.
    var pestana = window.open('', '_blank');
    bloquear(form, true);
    mostrar(aviso, 'Enviando…', 'info');
    enviar(d, 'whatsapp').then(function () {
      if (pestana) pestana.location.href = url; else location.assign(url);
      form.reset();
      mostrar(aviso, '¡Listo, ' + primerNombre(d.nombre) + '! Te abrimos WhatsApp para que converses con un asesor.', 'ok', url, 'Abrir WhatsApp');
      avisarSitio(form, 'whatsapp');
    }, function (err) {
      if (pestana) pestana.close();
      if (err.corregible) return mostrar(aviso, err.message, 'error');
      // Si AMURA no responde, la persona igual puede escribir: el vendedor la registra desde la conversación.
      mostrar(aviso, 'No pudimos registrar tus datos, pero puedes escribirnos igual.', 'error', url, 'Continuar a WhatsApp');
    }).then(function () { bloquear(form, false); });
  }
  function alHacerClic(e) {
    var t = e.target && e.target.closest ? e.target.closest(WHATSAPP) : null;
    if (!t || t.closest('[data-amura-sin-captura]') || (ventana && ventana.contains(t))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    abrirWhatsApp(t);
  }

  // ---- Inicio ---------------------------------------------------------------------------------------------------------
  function estilos() {
    var s = el('style');
    s.textContent = [
      '.amura-lw-trampa{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important}',
      '.amura-lw-consentimiento{display:flex;gap:8px;align-items:flex-start;flex-basis:100%;width:100%;margin:6px 0;font-size:12px;font-weight:400;line-height:1.45;text-align:left}',
      '.amura-lw-consentimiento input{flex:none;margin:2px 0 0}',
      '.amura-lw-estado{flex-basis:100%;width:100%;box-sizing:border-box;margin:6px 0;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.4;background:#eef2fb;color:#18243d}',
      '.amura-lw-estado[hidden]{display:none!important}',
      '.amura-lw-estado[data-tipo=ok]{background:#e3f7f2;color:#0b6b55}',
      '.amura-lw-estado[data-tipo=error]{background:#fde8ec;color:#9f1239}',
      '.amura-lw-estado a{color:inherit;font-weight:600}',
      '.amura-lw-fondo{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55)}',
      '.amura-lw-fondo[hidden]{display:none!important}',
      '.amura-lw-dialogo{position:relative;box-sizing:border-box;width:100%;max-width:400px;max-height:calc(100vh - 32px);overflow:auto;padding:22px 20px 20px;border-radius:16px;background:#fff;color:#18243d;box-shadow:0 20px 50px rgba(0,0,0,.25);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left}',
      '.amura-lw-dialogo form{display:grid;gap:10px;margin:0}',
      '.amura-lw-dialogo h2{margin:0;font-size:19px;line-height:1.25;color:#18243d}',
      '.amura-lw-dialogo p{margin:0;font-size:14px;color:#55627e}',
      '.amura-lw-dialogo label{display:grid;gap:4px;font-size:13px;font-weight:600;color:#18243d}',
      '.amura-lw-dialogo .amura-lw-consentimiento{display:flex;font-weight:400;color:#55627e}',
      '.amura-lw-dialogo input[type=tel],.amura-lw-dialogo input:not([type]){box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #d9deea;border-radius:10px;background:#fff;color:#18243d;font:inherit;font-size:16px;font-weight:400}',
      '.amura-lw-boton{padding:12px;border:0;border-radius:10px;background:#128c4b;color:#fff;font:inherit;font-weight:600;cursor:pointer}',
      '.amura-lw-boton:disabled{opacity:.6;cursor:wait}',
      '.amura-lw-cerrar{position:absolute;top:6px;right:10px;padding:4px;border:0;background:none;color:#55627e;font-size:24px;line-height:1;cursor:pointer}'
    ].join('');
    document.head.appendChild(s);
  }
  function prepararEn(raiz) {
    if (raiz.matches && raiz.matches(FORMULARIOS)) preparar(raiz);
    if (raiz.querySelectorAll) Array.prototype.forEach.call(raiz.querySelectorAll(FORMULARIOS), preparar);
  }
  function iniciar() {
    estilos();
    procedencia();
    prepararEn(document);
    // Formularios que aparecen después (ventanas emergentes, pestañas): se preparan al agregarse a la página.
    if (window.MutationObserver) {
      new MutationObserver(function (cambios) {
        cambios.forEach(function (c) {
          Array.prototype.forEach.call(c.addedNodes, function (n) { if (n.nodeType === 1) prepararEn(n); });
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  document.addEventListener('submit', alEnviar, true);
  document.addEventListener('click', alHacerClic, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarWhatsApp(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  window.AmuraLeads = { abrirWhatsApp: function () { abrirWhatsApp(null); }, configuracion: cfg };
})();
