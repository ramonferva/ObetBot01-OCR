/**
 * ocrClaude.js
 * Extrae datos de comprobantes de pago usando Claude API (Anthropic).
 * Soporta imágenes (jpeg, png, gif, webp) y PDFs.
 */

const axios = require('axios');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL   = 'claude-sonnet-4-6';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

const PROMPT = `Analiza este comprobante de pago bancario venezolano y extrae los datos en formato JSON.
Responde ÚNICAMENTE con el JSON, sin texto adicional, sin bloques de código markdown.

Primero identifica el tipo de comprobante:
- "transferencia": transferencia bancaria por número de cuenta
- "pago_movil": Tpago, Pago Móvil — el destino es un número de teléfono
- "deposito": depósito bancario — NO indica banco emisor

Campos a extraer según tipo:

TRANSFERENCIA:
- tipo: "transferencia"
- banco: banco emisor (ej: "Mercantil", "Banesco", "BDV")
- monto: solo números y punto decimal (ej: 45925.34)
- fecha: DD/MM/YYYY sin hora
- referencia: número de referencia completo
- cuenta: número de cuenta destino completo o últimos 4 dígitos
- documento: cédula del titular si aparece, si no null

PAGO MÓVIL:
- tipo: "pago_movil"
- banco: banco emisor
- monto: solo números y punto decimal
- fecha: DD/MM/YYYY sin hora
- referencia: número de referencia
- telefono: número de teléfono destino (ej: "0414-0215058")
- documento: cédula si aparece, si no null
- beneficiario: nombre si aparece, si no null

DEPÓSITO (NO tiene banco emisor visible):
- tipo: "deposito"
- banco: null
- monto: solo números y punto decimal
- fecha: DD/MM/YYYY sin hora
- referencia: número del depósito
- cuenta: número de cuenta receptora
- documento: cédula si aparece, si no null
- beneficiario: nombre si aparece, si no null

Si un campo no aplica al tipo o no aparece, coloca null.

Ejemplos:

Transferencia:
{
  "tipo": "transferencia",
  "banco": "Banco Mercantil C.A.",
  "monto": "45925.34",
  "fecha": "28/05/2026",
  "referencia": "61485551518",
  "cuenta": "0105-0079-64-1079599622",
  "documento": "V12345678",
  "beneficiario": null  
}

Pago Móvil:
{
  "tipo": "pago_movil",
  "banco": "Mercantil",
  "monto": "1100.00",
  "fecha": "25/05/2026",
  "referencia": "47526065",
  "cuenta": null,
  "telefono": "0414-0215058",
  "documento": "V9128000",
  "beneficiario": "Armando Duque"
}

Depósito:
{
  "tipo": "deposito",
  "banco": null,
  "monto": "5000.00",
  "fecha": "28/05/2026",
  "referencia": "00123456",
  "cuenta": "01050079641079599622",
  "telefono": null,
  "documento": "V12345678",
  "beneficiario": null
}`;

/**
 * Detecta el tipo de archivo por content-type o extensión de la URL
 */
const detectarTipoArchivo = (url, contentType) => {
  const ct = (contentType || '').toLowerCase();
  const urlLower = (url || '').toLowerCase();

  if (ct.includes('pdf') || urlLower.endsWith('.pdf')) {
    return { esPDF: true, mediaType: 'application/pdf' };
  }
  if (ct.includes('png') || urlLower.endsWith('.png')) {
    return { esPDF: false, mediaType: 'image/png' };
  }
  if (ct.includes('gif') || urlLower.endsWith('.gif')) {
    return { esPDF: false, mediaType: 'image/gif' };
  }
  if (ct.includes('webp') || urlLower.endsWith('.webp')) {
    return { esPDF: false, mediaType: 'image/webp' };
  }
  // Default: jpeg
  return { esPDF: false, mediaType: 'image/jpeg' };
};

/**
 * Descarga el archivo y lo convierte a base64
 */
const downloadFileBase64 = async (fileUrl) => {
  const response = await axios.get(fileUrl, {
    responseType: 'arraybuffer',
    timeout: 15000,
  });

  const contentType = response.headers['content-type'] || '';
  const base64 = Buffer.from(response.data).toString('base64');
  const tipoArchivo = detectarTipoArchivo(fileUrl, contentType);

  return { base64, ...tipoArchivo };
};

/**
 * Construye el contenido del mensaje según el tipo de archivo
 */
const buildMessageContent = (base64, esPDF, mediaType) => {
  if (esPDF) {
    // PDFs se envían como documentos
    return [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64,
        },
      },
      {
        type: 'text',
        text: PROMPT,
      },
    ];
  }

  // Imágenes
  return [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64,
      },
    },
    {
      type: 'text',
      text: PROMPT,
    },
  ];
};

/**
 * Envía el archivo a Claude y recibe los datos estructurados
 */
const extractWithClaude = async (fileUrl) => {
  const { base64, esPDF, mediaType } = await downloadFileBase64(fileUrl);
  console.log(`Claude OCR → tipo detectado: ${esPDF ? 'PDF' : 'imagen'} (${mediaType})`);
  console.log("Base64 primeros 50 chars:", base64.substring(0, 50));
  console.log("MediaType:", mediaType);
  console.log("Es PDF:", esPDF);

  const payload = {
    model: CLAUDE_MODEL,
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: buildMessageContent(base64, esPDF, mediaType),
      },
    ],
  };

  const response = await axios.post(CLAUDE_API_URL, payload, {
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    timeout: 30000,
  });
  console.log("Claude OCR → RESPONSE:", response);  
  const rawText = response.data.content[0].text.trim();
  console.log("Claude OCR → respuesta raw:", rawText);

  // Limpiar posibles bloques markdown ```json ... ```
  const clean = rawText.replace(/```json|```/g, '').trim();
  const datos = JSON.parse(clean);

  return datos;
};

/**
 * Función principal: recibe URL de imagen o PDF, retorna datos del comprobante
 */
const procesarComprobante = async (fileUrl) => {
  console.log("Claude OCR → API KEY:", CLAUDE_API_KEY);
  console.log("Claude OCR → procesando:", fileUrl);
  try {
    const datos = await extractWithClaude(fileUrl);
    console.log("Claude OCR → datos extraídos:", datos);

    return {
      exito: true,
      datos,
      camposFaltantes: [], // ocrService recalcula según tipo
      completo: false,     // ocrService recalcula según tipo
    };
  } catch (error) {
    if (error.response) {
    console.error("Claude OCR → status:", error.response.status);
    console.error("Claude OCR → error detalle:", JSON.stringify(error.response.data));
  } else {
    console.error("Claude OCR → error:", error.message);
  }
  return {
    exito: false,
    datos: null,
    camposFaltantes: [],
    completo: false,
    error: error.message,
  };
  }
};

module.exports = { procesarComprobante };