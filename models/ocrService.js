/**
 * ocrService.js
 * Servicio unificado de OCR. Selecciona el proveedor según variable de entorno
 * OCR_PROVIDER=vision | claude  (default: claude)
 *
 * Uso en intent.js:
 *   const OCR = require('../models/ocrService');
 *   const resultado = await OCR.procesarComprobante(attachmentUrl);
 */

const PROVIDER = process.env.OCR_PROVIDER || 'claude';

// Campos requeridos según tipo de comprobante
const CAMPOS_REQUERIDOS = {
  transferencia: ['banco', 'monto', 'fecha', 'referencia', 'cuenta'],
  pago_movil:    ['banco', 'monto', 'fecha', 'referencia', 'telefono'],
  deposito:      ['monto', 'fecha', 'referencia', 'cuenta'],
};

const procesarComprobante = async (imageUrl) => {
  if (!imageUrl) {
    return {
      exito: false,
      datos: null,
      camposFaltantes: ['monto', 'fecha', 'referencia', 'cuenta'],
      completo: false,
      error: 'No se recibió URL de imagen',
    };
  }

  let resultado;
  if (PROVIDER === 'vision') {
    const OCR = require('./ocrVision');
    resultado = await OCR.procesarComprobante(imageUrl);
  } else {
    const OCR = require('./ocrClaude');
    resultado = await OCR.procesarComprobante(imageUrl);
  }

  // Recalcular camposFaltantes según el tipo detectado
  if (resultado.exito && resultado.datos) {
    const tipo = resultado.datos.tipo || 'transferencia';
    const requeridos = CAMPOS_REQUERIDOS[tipo] || CAMPOS_REQUERIDOS.transferencia;
    resultado.camposFaltantes = requeridos.filter(c => !resultado.datos[c]);
    resultado.completo = resultado.camposFaltantes.length === 0;
    resultado.tipo = tipo;
  }

  return resultado;
};

/**
 * Genera el mensaje de Twilio solicitando los campos faltantes
 * según el tipo de comprobante detectado
 */
const mensajeCamposFaltantes = (camposFaltantes, tipo = 'transferencia') => {
  const labels = {
    banco:      '🏦 Banco emisor',
    monto:      '💰 Monto (en Bs.)',
    fecha:      '📅 Fecha de la operación (DD/MM/YYYY)',
    referencia: '🔢 Número de referencia',
    cuenta:     '🏧 Número de cuenta destino',
    telefono:   '📱 Número de teléfono destino',
    documento:  '🪪 Cédula del titular (ej: V12345678)',
  };

  const lista = camposFaltantes.map(c => `• ${labels[c] || c}`).join('\n');
  return `No pude leer todos los datos del comprobante. Por favor indícame:\n\n${lista}`;
};

/**
 * Formatea los datos del comprobante para mostrar al cliente
 */
const formatearResumen = (datos) => {
  const tipoLabel = {
    transferencia: '🏦 Transferencia',
    pago_movil:    '📱 Pago Móvil',
    deposito:      '🏧 Depósito',
  }[datos.tipo] || '🏦 Transferencia';

  const monto = datos.monto
    ? `Bs. ${parseFloat(datos.monto).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
    : null;

  const lineas = [
    `*Tipo:* ${tipoLabel}`,
    datos.banco        ? `*Banco:* ${datos.banco}`           : null,
    monto              ? `*Monto:* ${monto}`                  : null,
    datos.fecha        ? `*Fecha:* ${datos.fecha}`            : null,
    datos.referencia   ? `*Referencia:* ${datos.referencia}`  : null,
    datos.cuenta       ? `*Cuenta:* ${datos.cuenta}`          : null,
    datos.telefono     ? `*Teléfono:* ${datos.telefono}`      : null,
    datos.documento    ? `*Cédula:* ${datos.documento}`       : null,
    datos.beneficiario ? `*Beneficiario:* ${datos.beneficiario}` : null,
  ].filter(Boolean);

  return `✅ Leí tu comprobante:\n\n${lineas.join('\n')}\n\n¿Los datos son correctos? Responde *SI* o *NO*`;
};

module.exports = { procesarComprobante, mensajeCamposFaltantes };
