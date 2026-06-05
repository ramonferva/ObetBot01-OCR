/**
 * ocrVision.js
 * Extrae datos de comprobantes de pago usando Google Cloud Vision API.
 * Reutiliza las credenciales de dialogflow-account.json ya existentes.
 * Maneja 3 tipos: transferencia, pago_movil, deposito
 */

const vision = require('@google-cloud/vision');
const axios  = require('axios');

const DIALOGFLOW_ACCOUNT_PATH = `${__dirname}/../config/dialogflow-account.json`;

// ── Keywords para detección de tipo ─────────────────────────────────────────
const KEYWORDS_TIPO = {
  pago_movil:   ['tpago', 'pago móvil', 'pago movil', 'transferencia movil',
                 'enviar tpago', 'transferencia telefono'],
  deposito:     ['depósito', 'deposito', 'planilla de depósito', 'planilla deposito'],
  transferencia:['transferencia', 'transfer', 'código de cuenta', 'cuenta cliente',
                 'número de cuenta', 'numero de cuenta'],
};

// ── Keywords para extracción de campos ──────────────────────────────────────
const KEYWORDS = {
  banco:      ['banco', 'banesco', 'mercantil', 'bdv', 'venezuela', 'bicentenario',
               'bnc', 'provincial', 'sofitasa', 'exterior', 'fondo', 'corp',
               'nombre del banco', 'banco destino', 'banco origen'],
  monto:      ['monto', 'bs.', 'bsf', 'bolívar', 'bolivar', 'total', 'importe',
               'cantidad', 'monto (bs.)'],
  fecha:      ['fecha', 'date', 'día', 'dia', 'fecha y hora', 'fecha del'],
  referencia: ['referencia', 'ref.', 'nro.', 'número de referencia',
               'numero de referencia', 'operacion', 'transaccion', 'confirmacion',
               'número de operación', 'nro. de referencia'],
  cuenta:     ['cuenta', 'cta.', 'número de cuenta', 'numero de cuenta',
               'cuenta receptora', 'cuenta destino', 'cuenta corriente',
               'cuenta de ahorro'],
  telefono:   ['teléfono', 'telefono', 'tlf', 'número de teléfono', 'celular',
               'movil', 'beneficiario'],
  documento:  ['cédula', 'cedula', 'ci', 'rif', 'documento', 'titular',
               'documento de identidad'],
};

// ── Lista de bancos venezolanos para identificar banco en texto libre ────────
const NOMBRES_BANCO = [
  'mercantil', 'banesco', 'venezuela', 'bdv', 'provincial', 'bbva',
  'bicentenario', 'bnc', 'bod', 'sofitasa', 'exterior', 'corp banca',
  'tesoro', 'banfanb', 'bangente', 'banplus', 'mibanco', 'bancamiga',
  'bancrecer', 'activo', 'caribe', 'plaza', 'fondo comun', 'delsur',
  'citibank', 'caroni',
];

/**
 * Descarga la imagen desde Kommunicate y la convierte a base64
 */
const downloadImage = async (imageUrl) => {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 15000,
  });
  return Buffer.from(response.data).toString('base64');
};

/**
 * Extrae el texto completo de la imagen con Google Vision
 */
const extractTextFromImage = async (imageBase64) => {
  const client = new vision.ImageAnnotatorClient({
    keyFilename: DIALOGFLOW_ACCOUNT_PATH,
  });

  const [result] = await client.textDetection({
    image: { content: imageBase64 },
  });

  const detections = result.textAnnotations;
  if (!detections || detections.length === 0) {
    throw new Error('No se detectó texto en la imagen');
  }

  return detections[0].description; // texto completo
};

/**
 * Detecta el tipo de comprobante por palabras clave en el texto
 */
const detectarTipo = (text) => {
  const lower = text.toLowerCase();

  // Pago móvil primero (más específico)
  for (const kw of KEYWORDS_TIPO.pago_movil) {
    if (lower.includes(kw)) return 'pago_movil';
  }

  // Depósito
  for (const kw of KEYWORDS_TIPO.deposito) {
    if (lower.includes(kw)) return 'deposito';
  }

  // Si tiene número de cuenta largo → transferencia
  if (/\d{20}/.test(text.replace(/[-\s]/g, ''))) return 'transferencia';

  // Default
  return 'transferencia';
};

/**
 * Parsea el texto OCR y extrae los datos según el tipo detectado
 */
const parseComprobanteText = (text) => {
  const lines    = text.split('\n').map(l => l.trim()).filter(Boolean);
  const linesLow = lines.map(l => l.toLowerCase());
  const tipo     = detectarTipo(text);

  const resultado = {
    tipo,
    banco:       null,
    monto:       null,
    fecha:       null,
    referencia:  null,
    cuenta:      null,
    telefono:    null,
    documento:   null,
    beneficiario:null,
    textoCompleto: text,
  };

  for (let i = 0; i < linesLow.length; i++) {
    const line     = linesLow[i];
    const lineOrig = lines[i];
    const next     = linesLow[i + 1] || '';
    const nextOrig = lines[i + 1]    || '';
    const combined     = line + ' ' + next;
    const combinedOrig = lineOrig + ' ' + nextOrig;

    // ── Banco ────────────────────────────────────────────────────────────────
    // Depósitos no tienen banco emisor visible
    if (!resultado.banco && tipo !== 'deposito') {
      for (const kw of KEYWORDS.banco) {
        if (line.includes(kw)) {
          // La siguiente línea suele tener el nombre real del banco
          for (const nombre of NOMBRES_BANCO) {
            if (combined.includes(nombre)) {
              resultado.banco = nombre.charAt(0).toUpperCase() + nombre.slice(1);
              break;
            }
          }
          // Si no encontró nombre conocido, toma la siguiente línea
          if (!resultado.banco && nextOrig.length > 3) {
            resultado.banco = nextOrig;
          }
          break;
        }
      }
      // Detección directa: línea contiene nombre de banco conocido
      if (!resultado.banco) {
        for (const nombre of NOMBRES_BANCO) {
          if (line.includes(nombre)) {
            resultado.banco = lineOrig;
            break;
          }
        }
      }
    }

    // ── Monto ────────────────────────────────────────────────────────────────
    if (!resultado.monto) {
      for (const kw of KEYWORDS.monto) {
        if (line.includes(kw)) {
          // Busca número con formato monetario venezolano: 1.100,00 o 45925.34
          const match = combinedOrig.match(/[\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})/);
          if (match) {
            // Normalizar a formato con punto decimal
            resultado.monto = match[0]
              .replace(/\./g, '')   // quitar separadores de miles
              .replace(',', '.');   // coma decimal → punto
          } else {
            // Número simple
            const simple = combinedOrig.match(/\d+[.,]\d+/);
            if (simple) resultado.monto = simple[0].replace(',', '.');
          }
          break;
        }
      }
    }

    // ── Fecha ────────────────────────────────────────────────────────────────
    if (!resultado.fecha) {
      // Busca DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
      const fechaMatch =
        combined.match(/\d{2}[\/\-]\d{2}[\/\-]\d{4}/) ||
        combined.match(/\d{4}[\/\-]\d{2}[\/\-]\d{2}/);
      if (fechaMatch) {
        resultado.fecha = fechaMatch[0].replace(/-/g, '/');
      }
    }

    // ── Referencia ───────────────────────────────────────────────────────────
    if (!resultado.referencia) {
      for (const kw of KEYWORDS.referencia) {
        if (line.includes(kw)) {
          const match = combinedOrig.match(/\d{6,}/);
          if (match) resultado.referencia = match[0];
          break;
        }
      }
    }

    // ── Cuenta (transferencia / depósito) ────────────────────────────────────
    if (!resultado.cuenta && tipo !== 'pago_movil') {
      for (const kw of KEYWORDS.cuenta) {
        if (line.includes(kw)) {
          // Número de cuenta venezolano: 20 dígitos o formato 0105-0079-64-...
          const match = combinedOrig.replace(/[\s\-]/g, '').match(/\d{20}/);
          if (match) {
            resultado.cuenta = match[0];
          } else {
            // Últimos 4 dígitos con asteriscos: ****9119
            const partial = combinedOrig.match(/\*{2,}\d{4}/);
            if (partial) resultado.cuenta = partial[0];
          }
          break;
        }
      }
    }

    // ── Teléfono (pago móvil) ────────────────────────────────────────────────
    if (!resultado.telefono && tipo === 'pago_movil') {
      for (const kw of KEYWORDS.telefono) {
        if (line.includes(kw)) {
          // Teléfono venezolano: 0414-1234567 o 04141234567
          const match = combinedOrig.match(/0[24]\d{2}[\-]?\d{7}/);
          if (match) resultado.telefono = match[0];
          break;
        }
      }
      // Búsqueda directa de número de teléfono en la línea
      if (!resultado.telefono) {
        const match = lineOrig.match(/0[24]\d{2}[\-]?\d{7}/);
        if (match) resultado.telefono = match[0];
      }
    }

    // ── Documento / Cédula ───────────────────────────────────────────────────
    if (!resultado.documento) {
      for (const kw of KEYWORDS.documento) {
        if (line.includes(kw)) {
          const match = combinedOrig.match(/[VvEe][\-\.]?\d{6,9}/);
          if (match) resultado.documento = match[0].replace(/[\-\.]/g, '');
          break;
        }
      }
    }

    // ── Beneficiario ─────────────────────────────────────────────────────────
    if (!resultado.beneficiario) {
      if (line.includes('beneficiario') || line.includes('destinatario')) {
        if (nextOrig && !/^\d/.test(nextOrig)) {
          resultado.beneficiario = nextOrig;
        }
      }
    }
  }

  return resultado;
};

/**
 * Función principal: recibe URL de imagen, retorna datos estructurados
 */
const procesarComprobante = async (imageUrl) => {
  console.log("Vision OCR → procesando imagen:", imageUrl);
  try {
    const imageBase64 = await downloadImage(imageUrl);
    const texto       = await extractTextFromImage(imageBase64);
    console.log("Vision OCR → texto extraído:\n", texto);

    const datos = parseComprobanteText(texto);
    console.log("Vision OCR → tipo detectado:", datos.tipo);
    console.log("Vision OCR → datos parseados:", datos);

    return {
      exito: true,
      datos,
      tipo: datos.tipo,
      // camposFaltantes se recalcula en ocrService según el tipo
      camposFaltantes: [],
      completo: false,
    };
  } catch (error) {
    console.error("Vision OCR → error:", error);
    return {
      exito: false,
      datos: null,
      tipo: null,
      camposFaltantes: [],
      completo: false,
      error: error.message,
    };
  }
};

module.exports = { procesarComprobante };