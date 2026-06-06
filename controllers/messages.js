const Dialogflow = require("../models/dialogflow");
const Twilio = require("../models/twilio");
const intentVery = require("../controllers/intent");
const {
  verifyIntent,
  sendSaludo,
  limpiarSesionRedis,
} = require("../controllers/intent");
const api = require("../routes/api");
const OCR = require("../models/ocrService");
const Redis = require("../config/redis");

/**
 * Convierte el número de teléfono al formato E.164.
 * Maneja el nuevo formato de Meta: "whatsapp:VE.1482982650009223"
 * y el formato estándar: "+584122724600"
 */
const normalizePhone = (fromRaw, userPhone) => {
  // Prioridad 1: usar $user_phone de userInfo (ya viene en E.164)
  if (userPhone && userPhone.startsWith("+")) {
    console.log("phoneNumber desde userInfo.$user_phone:", userPhone);
    return userPhone;
  }

  // Prioridad 2: parsear el campo from si viene en nuevo formato Meta
  if (fromRaw && fromRaw.includes("whatsapp:")) {
    // "whatsapp:VE.1482982650009223" → "+584122724600" no es posible directamente
    // pero "whatsapp:+584122724600" sí
    const cleaned = fromRaw.replace("whatsapp:", "");

    // Nuevo formato Meta: "VE.1482982650009223" (no convertible a E.164 directamente)
    if (/^[A-Z]{2}\./.test(cleaned)) {
      console.warn(
        "Formato Meta nuevo detectado, no convertible sin userInfo:",
        fromRaw,
      );
      return null;
    }

    // Formato estándar con prefijo whatsapp: "whatsapp:+584122724600"
    return cleaned;
  }

  // Prioridad 3: ya viene en E.164
  return fromRaw ?? null;
};

/**
 * Mapea nombre/código/sinónimo de banco al código numérico
 * que usa la entidad @banco de Dialogflow.
 * Generado automáticamente desde entities/banco_entries_es.json
 */
const BANCO_MAP = {
  156: "156",
  "100%banco": "156",
  "100% banco": "156",
  "0156": "156",
  196: "196",
  "abn amro bank": "196",
  "0196": "196",
  172: "172",
  "bancamiga banco microfinanciero, c.a.": "172",
  bancamiga: "172",
  "0172": "172",
  171: "171",
  "banco activo banco comercial, c.a.": "171",
  "banco activo": "171",
  "0171": "171",
  166: "166",
  "banco agricola": "166",
  "0166": "166",
  175: "175",
  "banco bicentenario": "175",
  bicentenario: "175",
  "0175": "175",
  128: "128",
  "banco caroni, c.a. banco universal": "128",
  caroni: "128",
  "0128": "128",
  164: "164",
  "banco de desarrollo del microempresario": "164",
  microempresario: "164",
  "0164": "164",
  102: "102",
  venezuela: "102",
  "0102": "102",
  "banco venezuela": "102",
  114: "114",
  "banco del caribe c.a.": "114",
  caribe: "114",
  "0114": "114",
  149: "149",
  "banco del pueblo soberano c.a.": "149",
  "pueblo soberano": "149",
  "0149": "149",
  163: "163",
  "banco del tesoro": "163",
  tesoro: "163",
  "0163": "163",
  176: "176",
  "banco espirito santo, s.a.": "176",
  "espiritu santo": "176",
  "0176": "176",
  115: "115",
  "banco exterior c.a.": "115",
  exterior: "115",
  "0115": "115",
  3: "3",
  "banco industrial de venezuela.": "3",
  "industrial de venezuela": "3",
  "0003": "3",
  173: "173",
  "banco internacional de desarrollo, c.a.": "173",
  "internacional de desarrollo": "173",
  "0173": "173",
  105: "105",
  "banco mercantil c.a.": "105",
  mercantil: "105",
  "0105": "105",
  191: "191",
  "banco nacional de credito": "191",
  bnc: "191",
  "nacional credito": "191",
  "0191": "191",
  116: "116",
  "banco occidental de descuento.": "116",
  bod: "116",
  "occidental descuento": "116",
  "0116": "116",
  138: "138",
  "banco plaza": "138",
  plaza: "138",
  "0138": "138",
  108: "108",
  "banco provincial bbva": "108",
  provincial: "108",
  "0108": "108",
  104: "104",
  "banco venezolano de credito s.a.": "104",
  "venezola credito": "104",
  "0104": "104",
  168: "168",
  "bancrecer s.a. banco de desarrollo": "168",
  bancrecer: "168",
  "0168": "168",
  "banesco banco universal": "134",
  banesco: "134",
  177: "177",
  banfanb: "177",
  "0177": "177",
  146: "146",
  bangente: "146",
  "0146": "146",
  174: "174",
  "banplus banco comercial c.a": "174",
  banplus: "174",
  "0174": "174",
  190: "190",
  "citibank.": "190",
  citibank: "190",
  "0190": "190",
  121: "121",
  "corp banca.": "121",
  "corp banca": "121",
  "0121": "121",
  157: "157",
  "delsur banco universal": "157",
  "del sul": "157",
  "0157": "157",
  151: "151",
  "fondo comun": "151",
  "0151": "151",
  601: "601",
  "instituto municipal de crédito popular": "601",
  "0601": "601",
  169: "169",
  "mibanco banco de desarrollo, c.a.": "169",
  "0169": "169",
  137: "137",
  sofitasa: "137",
  "0137": "137",
};

const mapearBanco = (nombreBanco) => {
  if (!nombreBanco) return null;
  const nombre = nombreBanco.toLowerCase().trim();
  // Búsqueda exacta primero
  if (BANCO_MAP[nombre]) return BANCO_MAP[nombre];
  // Búsqueda parcial — el nombre del OCR puede tener palabras extra
  for (const [key, code] of Object.entries(BANCO_MAP)) {
    if (nombre.includes(key) || key.includes(nombre)) return code;
  }
  return null;
};

const messageInfo = async (req, res) => {
  const body = req.body;
  let responseDF;
  let result = null;

  const {
    message: messageText,
    from: fromRaw,
    groupId: messageId,
    userInfo: { $user_phone: userPhone = null } = {},
    metadata: { KM_CHAT_CONTEXT: { attachments = [] } = {} } = {},
  } = req.body;

  // Normalizar número al formato E.164
  const phoneNumber = normalizePhone(fromRaw, userPhone);

  // Extraer URL del adjunto: estructura [{ type, payload: { name, url, size } }]
  const attachmentUrl =
    attachments.length > 0 ? (attachments[0]?.payload?.url ?? null) : null;

  //const attachmentUrl = "https://obelisco.com.ve/upload/30313023_03-06-2026_1118831.png";
  console.log("phoneNumber normalizado:", phoneNumber);
  console.log("attachmentUrl:", attachmentUrl);

  if (!phoneNumber) {
    console.error("No se pudo determinar un número de teléfono válido");
    return res.status(200).send();
  }

  try {
    // ════════════════════════════════════════════════════════════════════════
    // ESCENARIO A: Solo imagen / Imagen + texto
    //   1. Guardar imagen en Redis si viene sin texto (espera 2do webhook)
    //   2. Con texto: verificar cliente en BD
    //   3. Si existe → activar contexto Dialogflow → OCR → transferencia
    //   4. Si no existe → Dialogflow pide código de cliente
    //
    // ESCENARIO B: Solo texto sin imagen → flujo normal Dialogflow
    // ════════════════════════════════════════════════════════════════════════

    // Recuperar imagen de Redis si existe para este usuario
    let attachmentUrlFinal = attachmentUrl;
    try {
      const redisClient = await Redis();
      const keyImg = `imagen:pendiente:${phoneNumber}`;

      if (attachmentUrl) {
        // Siempre guardar imagen en Redis (por si acaso se necesita después)
        await redisClient.set(keyImg, attachmentUrl, { EX: 300 });
      }

      if (!attachmentUrl && messageText) {
        // Solo texto — recuperar imagen guardada si existe
        const imgGuardada = await redisClient.get(keyImg);
        if (imgGuardada) {
          console.log("**** Imagen previa recuperada de Redis ****");
          attachmentUrlFinal = imgGuardada;
          await redisClient.del(keyImg);
        }
      }
    } catch (redisErr) {
      console.error("Error Redis:", redisErr);
    }

    // ── Función OCR ──────────────────────────────────────────────────────────
    const procesarImagenOCR = async () => {
      await Twilio.sendTextMessageWhatsapp(
        phoneNumber,
        "🔍 Recibí tu comprobante, estoy leyendo los datos...",
      );

      const ocr = await OCR.procesarComprobante(attachmentUrlFinal);
      console.log("OCR resultado:", ocr);

      if (ocr.exito) {
        const tipoIntent =
          ocr.tipo === "deposito" ? "deposito" : "transferencia";

        const flujoTransferencia = {
          eventName: 'EVENTO_TRANSFERENCIA_CLAUDE', // Nombre dinámico del evento en Dialogflow
          contextName: "reportar_transferencia", // Nombre que usará Dialogflow en su consola
          parameters: {
            banco: ocr.banco,
            cuenta: ocr.cuenta,
            referencia: ocr.referencia,
            fecha: ocr.fecha,
            monto: ocr.monto,
            documento: ocr.documento,
          },
        };

        console.log("tipoIntent generado para Dialogflow:", flujoTransferencia);
        const resp = await Dialogflow.dialogflowProccess(
          "Comprobante recibido exitosamente",
          phoneNumber,
          messageId,
          flujoTransferencia,
        );
        await intentVery.verifyIntent(
          phoneNumber,
          resp,
          messageId,
          tipoIntent,
          res,
          null,
        );
        return;
      } else {
        await Twilio.sendTextMessageWhatsapp(
          phoneNumber,
          "😕 No pude leer el comprobante. Voy a pedirte los datos uno a uno.",
        );
        const tipoIntent =
          ocr.tipo === "deposito" ? "deposito" : "transferencia";
        tipoIntent =
          tipoIntent +
          ocr.banco +
          "a la " +
          ocr.cuenta +
          "  con" +
          ocr.referencia +
          " en " +
          ocr.fecha +
          " por " +
          ocr.monto +
          " realizada por " +
          ocr.documento;
        console.log("tipoIntent generado para Dialogflow:", tipoIntent);
      }

      /* if (!ocr.completo) {
        await Twilio.sendTextMessageWhatsapp(phoneNumber, OCR.formatearResumen(ocr.datos));
        await Twilio.sendTextMessageWhatsapp(
          phoneNumber,
          OCR.mensajeCamposFaltantes(ocr.camposFaltantes, ocr.tipo)
        );
        return;
      } */

      // Datos completos — mostrar resumen y guardar en Redis para confirmación
      await Twilio.sendTextMessageWhatsapp(
        phoneNumber,
        OCR.formatearResumen(ocr.datos),
      );
      try {
        const redisClient = await Redis();
        await redisClient.set(
          `ocr:pendiente:${phoneNumber}`,
          JSON.stringify({ datos: ocr.datos, tipo: ocr.tipo }),
          { EX: 300 },
        );
        console.log("Datos OCR guardados en Redis para confirmación");
      } catch (redisErr) {
        console.error("Error guardando OCR en Redis:", redisErr);
      }
    };

    const ejecutarOCRConTimeout = async () => {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("OCR timeout")), 30000),
      );
      try {
        await Promise.race([procesarImagenOCR(), timeout]);
      } catch (err) {
        if (err.message === "OCR timeout") {
          await Twilio.sendTextMessageWhatsapp(
            phoneNumber,
            "😕 La lectura tardó demasiado. Por favor envíame los datos manualmente.",
          );
        } else throw err;
      }
    };

    // ── ESCENARIO A: imagen sin texto → saludo + verificar cliente ──────────
    if (attachmentUrlFinal && !messageText) {
      console.log("**** Escenario A: imagen sin texto ****");

      // Saludo siempre primero
      await sendSaludo(phoneNumber);

      // Verificar si el teléfono existe en BD
      let clienteExiste = false;
      let codigoCliente = null;
      try {
        const data = await api.getPhone(phoneNumber);
        const parsed = JSON.parse(data);
        if (parsed.mensaje != null) {
          clienteExiste = true;
          codigoCliente = parsed.codigo;
          console.log("Cliente encontrado, código:", codigoCliente);
        }
      } catch (err) {
        console.error("Error verificando cliente:", err);
      }

      if (!clienteExiste) {
        // No existe → pedir código, imagen ya está guardada en Redis
        console.log("Cliente no existe, pidiendo código");
        await Twilio.sendTextMessageWhatsapp(
          phoneNumber,
          "Para procesar tu comprobante necesito identificarte. " +
            "Por favor indícame tu *código de cliente*.",
        );
        return res.status(200).send();
      }

      // Existe → activar contexto "cliente" en Dialogflow con su código
      const respContexto = await Dialogflow.dialogflowProccess(
        String(codigoCliente),
        phoneNumber,
        messageId,
      );
      console.log("Contexto activado:", respContexto.action);

      // Procesar imagen con OCR
      await ejecutarOCRConTimeout();
      return res.status(200).send();
    }

    // ── ESCENARIO B: texto + imagen recuperada de Redis ───────────────────────
    // El usuario escribió su código después de mandar la imagen
    if (attachmentUrlFinal && messageText) {
      console.log("**** Escenario B: texto con imagen recuperada ****");

      // Dialogflow procesa el texto (valida código, activa contexto cliente)
      responseDF = await Dialogflow.dialogflowProccess(
        messageText.substring(0, 256),
        phoneNumber,
        messageId,
      );
      console.log("Dialogflow action:", responseDF.action);

      result = await intentVery.verifyIntent(
        phoneNumber,
        responseDF,
        messageId,
        messageText,
        res,
        attachmentUrlFinal,
      );

      if (!result) return res.status(200).send();

      // Si el cliente quedó identificado → procesar imagen con OCR
      if (result.status === 1) {
        console.log("Cliente identificado, procesando OCR...");
        await ejecutarOCRConTimeout();
        return res.status(200).send();
      }

      if (result.status === 3) {
        await transfiereAgente(res);
        return;
      }
      if (result.status === 4) {
        await resolveConversation(res);
        return;
      }

      return res.status(200).send();
    }

    // ── ESCENARIO D: solo texto, sin imagen ──────────────────────────────────
    if (messageText) {
      console.log("**** Entro en messages ****");

      responseDF = await Dialogflow.dialogflowProccess(
        messageText.substring(0, 256),
        phoneNumber,
        messageId,
      );

      if (responseDF.action) {
        result = await intentVery.verifyIntent(
          phoneNumber,
          responseDF,
          messageId,
          messageText,
          res,
          attachmentUrl,
        );
        console.log("resultado intentVery 1", result);

        if (!result) {
          console.error(
            "verifyIntent no retornó resultado, abortando flujo normal",
          );
          return res.status(200).send();
        }

        if (result.status === 1) {
          await Twilio.sendTextMessageWhatsapp(phoneNumber, responseDF.text);
        } else if (result.status === 3) {
          await transfiereAgente(res);
          return;
        } else if (result.status === 4) {
          await resolveConversation(res);
          return;
        }
      } else {
        if (responseDF.platform === "kommunicate") {
          console.log("entrooo kommunicate 1");
          if (responseDF.assign) {
            console.log("entrooo kommunicate 2");
            await transfiereAgente(res);
            await Twilio.sendTextMessageWhatsapp(phoneNumber, responseDF.text);
          } else {
            console.log("entrooo kommunicate 3");
            await Twilio.sendTextMessageWhatsappSid(
              phoneNumber,
              responseDF.metadata.contentSid,
            );
          }
        } else {
          console.log("entrooo kommunicate 4");
          await Twilio.sendTextMessageWhatsapp(phoneNumber, responseDF.text);
        }
      }

      console.log("response message 2", result ? result.message : null);
      return res.status(200).send();
    }

    // ── RAMA 3: ni texto ni imagen ───────────────────────────────────────────
    return res.status(200).send();
  } catch (error) {
    console.error("Dialogflow crash prevented:", error);
    try {
      await Twilio.sendTextMessageWhatsapp(
        phoneNumber,
        "Estamos presentando inconvenientes. Le estamos transfiriendo con un agente.",
      );
    } catch (twilioError) {
      console.error("Error enviando mensaje de fallo a Twilio:", twilioError);
    }
    if (!res.headersSent) {
      await transfiereAgente(res);
    }
  }
};

const transfiereAgente = async (res) => {
  console.log("Transfiere al agente ");
  let messages = [
    {
      message: "Te estamos transfiriendo con un agente...",
      metadata: {
        KM_ASSIGN_TO: "cobranzas4@obelisco.com.ve",
      },
    },
  ];
  if (!res.headersSent) {
    return res.status(200).send(messages);
  }
};

const sendKommunicate = async (texto, res) => {
  console.log("Enviando 200 ok ");
  let messages = [
    {
      platform: "kommunicate",
      message: texto,
    },
  ];
  if (!res.headersSent) {
    return res.status(200).send(messages);
  }
};

const resolveConversation = async (res) => {
  console.log("Cerrando la conversación");
  let messages = [
    {
      platform: "kommunicate",
      message:
        "Gracias por preferirnos, seguimos trabajando para brindarle la mejor atención " +
        " Administradora Obelisco 100% online 😉 ",
      metadata: {
        actionRequest: "resolveConversation",
      },
    },
  ];
  if (!res.headersSent) {
    return res.status(200).send(messages);
  }
};

const messageKommunicte = async (req, res) => {
  console.log("body", req.body);

  const {
    from: fromRaw,
    groupId: messageId,
    userInfo: { $user_phone: userPhone = null } = {},
  } = req.body;

  const phoneNumber = normalizePhone(fromRaw, userPhone);

  const contentSid = "HXaa20dad1324b8acf3b382e771235a7b9";

  const js = {
    1: "125",
    2: "8197",
    3: "12525",
    4: "150.25",
    5: "5/12/2024",
  };

  try {
    await Twilio.sendTextMessageWhatsappSidMsgN(
      phoneNumber,
      null,
      contentSid,
      js,
    );
    console.log("envio");
    return res.status(200).send();
  } catch (error) {
    console.error("Error en messageKommunicte:", error);
    if (!res.headersSent) {
      return res.status(500).send({ error: "Error enviando mensaje" });
    }
  }
};

module.exports = {
  messageInfo,
  messageKommunicte,
};
