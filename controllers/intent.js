const api = require("../routes/api");
const Twilio = require("../models/twilio");
const Dialogflow = require("../models/dialogflow");
const OCR = require("../models/ocrService");
const Redis = require("../config/redis");

/**
 * Limpia todas las claves Redis asociadas a una sesión del cliente.
 * Se llama al cerrar conversación o por inactividad.
 */
const limpiarSesionRedis = async (phone) => {
  try {
    const redisClient = await Redis();
    const claves = [
      `ocr:pendiente:${phone}`, // datos comprobante esperando confirmación
      `webhook:procesado:${phone}`, // deduplicación general
    ];
    // Buscar y eliminar también cualquier webhook procesado relacionado
    const keysWebhook = await redisClient.keys(`webhook:procesado:*`);
    const toDelete = [...claves, ...keysWebhook];
    if (toDelete.length > 0) {
      await redisClient.del(toDelete);
      console.log(`Redis → sesión limpiada para ${phone}:`, toDelete);
    }
  } catch (err) {
    console.error("Error limpiando Redis:", err);
  }
};

const verifyIntent = async (
  phone,
  response,
  messageId,
  message,
  res,
  attachmentUrl = null,
) => {
  const formatPhone = phone.substring(10);
  let val = 0;
  let texto = null;
  let resultado;

  try {
    console.log("**** entro en intent ****");

    let intent = response.action;
    let allRequiredParamsPresent = response.allRequiredParamsPresent;
    const outputContexts = response.outputContexts;

    if (intent === "input.welcome") {
      await sendSaludo(phone);

      await api
        .getPhone(phone)
        .then(async (data) => {
          resultado = data;
          data = JSON.parse(data);
          if (data.mensaje != null) {
            texto = data.mensaje;
            sendKommunicate(texto, res);
            let resp = await Dialogflow.dialogflowProccess(
              data.codigo,
              phone,
              messageId,
            );
            Twilio.sendTextMessageWhatsapp(phone, resp.text);
            resp = await Dialogflow.dialogflowProccess(
              "menu",
              phone,
              messageId,
            );
            await sendDialogTwilio(phone, resp, messageId, message);
          } else {
            texto = "No existe el nro telefono en base de datos";
            console.log(texto);
            const resp = await Dialogflow.dialogflowProccess(
              "cliente",
              phone,
              messageId,
            );
            Twilio.sendTextMessageWhatsapp(phone, resp.text);
          }
        })
        .catch((error) => {
          texto = "En breve será atendido por un agente, manténgase en línea.";
          Twilio.sendTextMessageWhatsapp(phone, texto);
          val = 3;
          console.error("Error en getPhone:", error);
        });

      console.log("resultado input.welcome:", resultado);
    } else if (intent === "input.cliente") {
      await api
        .getCodigo(message)
        .then(async (data) => {
          if (data != "") {
            if (data.includes("codigo")) {
              data = JSON.parse(data);
              texto = data.mensaje;
              sendKommunicate(texto, res);

              // Si hay imagen pendiente en Redis, ir al OCR en vez del menú
              if (attachmentUrl) {
                console.log(
                  "input.cliente: cliente identificado con imagen pendiente → OCR",
                );
                // Retornar status 1 para que messages.js procese el OCR
                val = 1;
              } else {
                // Flujo normal → ir al menú
                const resp = await Dialogflow.dialogflowProccess(
                  "menu",
                  phone,
                  messageId,
                );
                await sendDialogTwilio(phone, resp, messageId, message);
              }
            }
          } else {
            texto =
              "Código no existe, verifique e intente nuevamente (" +
              message +
              ")";
            Twilio.sendTextMessageWhatsapp(phone, texto);
            const resp = await Dialogflow.dialogflowProccess(
              "cliente",
              phone,
              messageId,
            );
            Twilio.sendTextMessageWhatsapp(phone, resp.text);
          }
        })
        .catch((error) => {
          texto =
            "Código no existe, verifique e intente nuevamente (" +
            message +
            ")";
          Twilio.sendTextMessageWhatsapp(phone, texto);
          console.error("Error en getCodigo:", error);
        });
    } else if (intent === "input.transferencia") {
      if (
        !outputContexts ||
        !outputContexts[0] ||
        !outputContexts[0].parameters
      ) {
        console.error("outputContexts inválido para input.transferencia");
        val = 1;
      } else {
        const context = outputContexts[0].parameters.fields;
        console.log("input.transferencia", JSON.stringify(context));
        console.log("input.transferencia attachmentUrl:", attachmentUrl);

        // Si el cliente envió una imagen de comprobante, procesarla con OCR
        if (attachmentUrl) {
          const ocr = await OCR.procesarComprobante(attachmentUrl);
          console.log("OCR resultado:", ocr);

          if (ocr.exito && ocr.completo) {
            // Todos los datos requeridos leídos — mostrar resumen para confirmar
            const resumen = OCR.formatearResumen(ocr.datos);
            await Twilio.sendTextMessageWhatsapp(phone, resumen);
            // Guardar datos OCR en contexto para usarlos en input.transferencia.yes
            // si el cliente responde SI
            val = 1;
          } else if (ocr.exito && !ocr.completo) {
            // Lectura parcial — mostrar lo que se leyó y pedir los faltantes
            const resumenParcial = OCR.formatearResumen(ocr.datos);
            const faltantes = OCR.mensajeCamposFaltantes(
              ocr.camposFaltantes,
              ocr.datos?.tipo,
            );
            await Twilio.sendTextMessageWhatsapp(phone, resumenParcial);
            await Twilio.sendTextMessageWhatsapp(phone, faltantes);
            val = 1;
          } else {
            // OCR falló completamente — pedir datos manualmente
            await Twilio.sendTextMessageWhatsapp(
              phone,
              "No pude leer el comprobante 😕 Por favor envíame los datos manualmente.",
            );
            val = 1;
          }
        } else if (allRequiredParamsPresent) {
          // Sin imagen — flujo normal con datos del contexto Dialogflow
          const fechaCreada = new Date(context.fecha.stringValue);
          const fechaFormateada = fechaCreada.toLocaleDateString("es-VE", {
            timeZone: "UTC",
          });

          const transferencia = {
            codigo: context.codigo.numberValue,
            cuenta: context.cuenta.numberValue,
            fecha: fechaFormateada,
            documento: context.documento.numberValue,
            monto: context.monto.numberValue,
            banco: context.banco.stringValue,
          };

          const mensaje = {
            1: `${transferencia.banco}`,
            2: `${transferencia.cuenta}`,
            3: `${transferencia.documento}`,
            4: `${transferencia.monto}`,
            5: `${transferencia.fecha}`,
          };
          Twilio.sendTextMessageWhatsappSidMsg(
            phone,
            mensaje,
            "HXaa20dad1324b8acf3b382e771235a7b9",
          );
        } else {
          texto = null;
          val = 1;
        }
      }
    } else if (intent === "input.transferenciaocr") {
      if (
        !outputContexts ||
        !outputContexts[0] ||
        !outputContexts[0].parameters
      ) {
        console.error("outputContexts inválido para input.transferencia");
        val = 1;
      } else {
        const context = outputContexts[0].parameters.fields;
        console.log("input.transferenciaOCR", JSON.stringify(context));
        console.log("input.transferencia attachmentUrl:", attachmentUrl);

        /* // Si el cliente envió una imagen de comprobante, procesarla con OCR
        if (attachmentUrl) {
          const ocr = await OCR.procesarComprobante(attachmentUrl);
          console.log("OCR resultado:", ocr);

          if (ocr.exito && ocr.completo) {
            // Todos los datos requeridos leídos — mostrar resumen para confirmar
            const resumen = OCR.formatearResumen(ocr.datos);
            await Twilio.sendTextMessageWhatsapp(phone, resumen);
            // Guardar datos OCR en contexto para usarlos en input.transferencia.yes
            // si el cliente responde SI
            val = 1;
          } else if (ocr.exito && !ocr.completo) {
            // Lectura parcial — mostrar lo que se leyó y pedir los faltantes
            const resumenParcial = OCR.formatearResumen(ocr.datos);
            const faltantes = OCR.mensajeCamposFaltantes(
              ocr.camposFaltantes,
              ocr.datos?.tipo,
            );
            await Twilio.sendTextMessageWhatsapp(phone, resumenParcial);
            await Twilio.sendTextMessageWhatsapp(phone, faltantes);
            val = 1;
          } else {
            // OCR falló completamente — pedir datos manualmente
            await Twilio.sendTextMessageWhatsapp(
              phone,
              "No pude leer el comprobante 😕 Por favor envíame los datos manualmente.",
            );
            val = 1;
          }
        }  */
        if (allRequiredParamsPresent) {
          // Sin imagen — flujo normal con datos del contexto Dialogflow
          const fechaCreada = new Date(context.fecha.stringValue);
          const fechaFormateada = fechaCreada.toLocaleDateString("es-VE", {
            timeZone: "UTC",
          });

          const transferencia = {
            codigo: context.codigo.numberValue,
            cuenta: context.cuenta.numberValue,
            fecha: fechaFormateada,
            documento: context.documento.numberValue,
            monto: context.monto.numberValue,
            banco: context.banco.stringValue,
          };

          const mensaje = {
            1: `${transferencia.banco}`,
            2: `${transferencia.cuenta}`,
            3: `${transferencia.documento}`,
            4: `${transferencia.monto}`,
            5: `${transferencia.fecha}`,
          };
          Twilio.sendTextMessageWhatsappSidMsg(
            phone,
            mensaje,
            "HXaa20dad1324b8acf3b382e771235a7b9",
          );
        } else {
          texto = null;
          val = 1;
        }
      }
    } else if (intent === "input.deposito") {
      if (
        !outputContexts ||
        !outputContexts[0] ||
        !outputContexts[0].parameters
      ) {
        console.error("outputContexts inválido para input.deposito");
        val = 1;
      } else {
        const context = outputContexts[0].parameters.fields;
        console.log("input.deposito", JSON.stringify(context));

        if (allRequiredParamsPresent) {
          const fechaCreada = new Date(context.fecha.stringValue);
          const fechaFormateada = fechaCreada.toLocaleDateString("es-VE", {
            timeZone: "UTC",
          });

          const deposito = {
            codigo: context.codigo.numberValue,
            cuenta: context.cuenta.numberValue,
            fecha: fechaFormateada,
            documento: context.documento.numberValue,
            monto: context.monto.numberValue,
          };

          const mensaje = {
            1: `${deposito.cuenta}`,
            2: `${deposito.documento}`,
            3: `${deposito.monto}`,
            4: `${deposito.fecha}`,
          };
          Twilio.sendTextMessageWhatsappSidMsg(
            phone,
            mensaje,
            "HX5335bca658627af9b0bff4a254e16c9c",
          );
        } else {
          texto = null;
          val = 1;
        }
      }
    } else if (intent === "input.transferencia.yes") {
      Twilio.sendTextMessageWhatsapp(phone, response.text);

      try {
        let transferencia = null;

        // Prioridad 1: datos OCR guardados en Redis
        try {
          const redisClient = await Redis();
          const ocrPendiente = await redisClient.get(`ocr:pendiente:${phone}`);
          if (ocrPendiente) {
            const { datos } = JSON.parse(ocrPendiente);
            console.log("input.transferencia.yes → usando datos OCR:", datos);
            transferencia = JSON.stringify({
              codigo: null,
              cuenta: datos.cuenta || null,
              fecha: datos.fecha || null,
              documento: datos.documento || null,
              monto: datos.monto || null,
              banco: datos.banco || null,
              telefono: datos.telefono || null,
              comprobante: attachmentUrl,
            });
            await redisClient.del(`ocr:pendiente:${phone}`);
          }
        } catch (redisErr) {
          console.error("Error leyendo OCR de Redis:", redisErr);
        }

        // Prioridad 2: contexto de Dialogflow (flujo manual)
        if (!transferencia) {
          if (
            !outputContexts ||
            !outputContexts[0] ||
            !outputContexts[0].parameters
          ) {
            console.error(
              "outputContexts inválido para input.transferencia.yes",
            );
            val = 3;
          } else {
            const context = outputContexts[0].parameters.fields;
            console.log("input.transferencia.yes → usando contexto Dialogflow");
            if (allRequiredParamsPresent) {
              const fechaCreada = new Date(context.fecha.stringValue);
              transferencia = JSON.stringify({
                codigo: context.codigo?.numberValue || null,
                cuenta: context.cuenta.numberValue,
                fecha: fechaCreada,
                documento: context.documento.numberValue,
                monto: context.monto.numberValue,
                banco: context.banco.stringValue,
                comprobante: attachmentUrl,
              });
            }
          }
        }

        // Guardar en BD si tenemos los datos
        if (transferencia) {
          const result = await api.setTransferencia(transferencia);
          let text =
            "su numero de confirmación es : *(" +
            result +
            ")* su notificación será validada en un tiempo estimado de 24 a 48 horas  ⏳";
          texto = text;
          if (result) {
            sendKommunicate(texto, res);
            const resp = await Dialogflow.dialogflowProccess(
              "cerrar",
              phone,
              messageId,
            );
            await sendDialogTwilio(phone, resp, messageId, message);
          } else {
            texto =
              "Hubo un error en la notificación de la transferencia, no se pudo procesar";
            sendKommunicate(texto, res);
            val = 3;
          }
        }
      } catch (error) {
        texto =
          "hubo un error en la notificación, le pondremos en contacto con un agente";
        Twilio.sendTextMessageWhatsapp(phone, texto);
        val = 3;
        console.error("Error en input.transferencia.yes:", error);
      }
    } else if (intent === "input.transferencia.no") {
      if (
        !outputContexts ||
        !outputContexts[0] ||
        !outputContexts[0].parameters
      ) {
        console.error("outputContexts inválido para input.transferencia.no");
        val = 1;
      } else {
        const context = outputContexts[0].parameters.fields;
        console.log("input.transferencia.no", JSON.stringify(context));
        Twilio.sendTextMessageWhatsapp(phone, response.text);
        const resp = await Dialogflow.dialogflowProccess(
          "menu",
          phone,
          messageId,
        );
        await sendDialogTwilio(phone, resp, messageId, message);
      }
    } else if (intent === "input.deposito.yes") {
      if (
        !outputContexts ||
        !outputContexts[0] ||
        !outputContexts[0].parameters
      ) {
        console.error("outputContexts inválido para input.deposito.yes");
        val = 3;
      } else {
        const context = outputContexts[0].parameters.fields;
        console.log("input.deposito.yes", JSON.stringify(context));
        Twilio.sendTextMessageWhatsapp(phone, response.text);

        try {
          if (allRequiredParamsPresent) {
            const fechaCreada = new Date(context.fecha.stringValue);
            const deposito = JSON.stringify({
              codigo: context.codigo.numberValue,
              cuenta: context.cuenta.numberValue,
              fecha: fechaCreada,
              documento: context.documento.numberValue,
              monto: context.monto.numberValue,
            });

            if (deposito) {
              const result = await api.setDeposito(deposito);
              let text =
                "su numero de confirmación es : *(" +
                result +
                ")* su notificación será validada en un tiempo estimado de 24 a 48 horas  ⏳";
              texto = text;
              if (result) {
                sendKommunicate(texto, res);
                const resp = await Dialogflow.dialogflowProccess(
                  "cerrar",
                  phone,
                  messageId,
                );
                await sendDialogTwilio(phone, resp, messageId, message);
              } else {
                texto =
                  "hubo un error en la notificación, le pondremos en contacto con un agente";
                Twilio.sendTextMessageWhatsapp(phone, texto);
              }
            }
          }
        } catch (error) {
          texto =
            "hubo un error en la notificación, le pondremos en contacto con un agente";
          Twilio.sendTextMessageWhatsapp(phone, texto);
          val = 3;
          console.error("Error en input.deposito.yes:", error);
        }
      }
    } else if (intent === "input.deposito.no") {
      if (
        !outputContexts ||
        !outputContexts[0] ||
        !outputContexts[0].parameters
      ) {
        console.error("outputContexts inválido para input.deposito.no");
        val = 1;
      } else {
        const context = outputContexts[0].parameters.fields;
        console.log("input.deposito.no", JSON.stringify(context));
        Twilio.sendTextMessageWhatsapp(phone, response.text);
        const resp = await Dialogflow.dialogflowProccess(
          "menu",
          phone,
          messageId,
        );
        await sendDialogTwilio(phone, resp, messageId, message);
      }
    } else if (intent === "input.cerrar.yes") {
      if (
        !outputContexts ||
        !outputContexts[0] ||
        !outputContexts[0].parameters
      ) {
        console.error("outputContexts inválido para input.cerrar.yes");
      } else {
        const context = outputContexts[0].parameters.fields;
        console.log("input.cerrar.yes", JSON.stringify(context));
      }
      // Limpiar toda la sesión de Redis al cerrar conversación
      await limpiarSesionRedis(phone);
      texto = "Cerrando Conversación";
      val = 4;
    } else if (intent === "input.cerrar.no") {
      if (
        !outputContexts ||
        !outputContexts[0] ||
        !outputContexts[0].parameters
      ) {
        console.error("outputContexts inválido para input.cerrar.no");
        val = 1;
      } else {
        const context = outputContexts[0].parameters.fields;
        console.log("input.cerrar.no", JSON.stringify(context));
        const resp = await Dialogflow.dialogflowProccess(
          "menu",
          phone,
          messageId,
        );
        await sendDialogTwilio(phone, resp, messageId, message);
      }
    } else if (intent === "input.unknown") {
      if (outputContexts && outputContexts[0] && outputContexts[0].parameters) {
        const context = outputContexts[0].parameters.fields;
        console.log("input.unknown", JSON.stringify(context));
      }
      val = 3;
    } else if (intent === "input.recibo") {
      if (
        !outputContexts ||
        !outputContexts[0] ||
        !outputContexts[0].parameters
      ) {
        console.error("outputContexts inválido para input.recibo");
        val = 1;
      } else {
        const context = outputContexts[0].parameters.fields;
        console.log("input.recibo", JSON.stringify(context));

        if (allRequiredParamsPresent) {
          const recibo = {
            mes: context.mes.numberValue,
            ano: context.ano.numberValue,
          };

          const mensaje = {
            1: `${recibo.mes}`,
            2: `${recibo.ano}`,
          };
          Twilio.sendTextMessageWhatsappSidMsg(
            phone,
            mensaje,
            "HXb294aadc9b3b2fd7be648406cf6f4b2b",
          );
        } else {
          texto = "Validando recibo";
          val = 1;
        }
      }
    } else if (intent === "input.recibo.yes") {
      if (
        !outputContexts ||
        !outputContexts[0] ||
        !outputContexts[0].parameters
      ) {
        console.error("outputContexts inválido para input.recibo.yes");
        val = 1;
      } else {
        const context = outputContexts[0].parameters.fields;
        console.log("input.recibo.yes", JSON.stringify(context));

        if (allRequiredParamsPresent) {
          const recibo = {
            codigo: context.codigo.numberValue,
            fecha: context.mes.numberValue + "-" + context.ano.numberValue,
          };

          if (recibo) {
            const result = await api.getReciboCondominio(recibo);
            let text = result;
            if (result) {
              texto = text;
              sendKommunicate(texto, res);
              const resp = await Dialogflow.dialogflowProccess(
                "cerrar",
                phone,
                messageId,
              );
              await sendDialogTwilio(phone, resp, messageId, message);
            } else {
              texto =
                "hubo un error en la petición, le pondremos en contacto con un agente";
              Twilio.sendTextMessageWhatsapp(phone, texto);
            }
          }
        } else {
          val = 1;
        }
      }
    } else {
      val = 1;
    }

    return { status: val, message: texto };
  } catch (error) {
    // BUG CORREGIDO: antes el catch no retornaba nada → verifyIntent devolvía undefined
    // y en messages.js `result.status` crasheaba con "Cannot read properties of undefined"
    console.error("Error Intent: ", error);
    return { status: 3, message: "Error interno, transfiriendo a agente" };
  }
};

const sendDialogTwilio = async (
  phoneNumber,
  response,
  messageId,
  messageText,
) => {
  try {
    if (response.action) {
      console.log("sendDialogTwilio: tiene action, re-procesando intent");
      // BUG CORREGIDO: antes pasaba `response.action` (string) en lugar de `response` (objeto)
      await verifyIntent(phoneNumber, response, messageId, messageText, null);
    } else {
      if (response.platform === "kommunicate") {
        await Twilio.sendTextMessageWhatsappSid(
          phoneNumber,
          response.metadata.contentSid,
        );
      } else {
        await Twilio.sendTextMessageWhatsapp(phoneNumber, response.text);
      }
    }
  } catch (error) {
    console.error("Error en sendDialogTwilio:", error);
  }
};

const sendSaludo = async (phoneNumber) => {
  console.log("Enviando saludo a", phoneNumber);
  try {
    let h = new Date().getHours();
    let msg = "";
    if (h >= 0 && h < 12) {
      msg =
        "¡Buenos días! Soy OBi, tu agente virtual. Gracias por contactarnos, Administradora Obelisco 100% online 😉.";
    } else if (h >= 12 && h < 18) {
      msg =
        "¡Buenas tardes! Soy OBi, tu agente virtual. Gracias por contactarnos, Administradora Obelisco 100% online 😉.";
    } else {
      msg =
        "¡Buenas noches! Soy OBi, tu agente virtual. Gracias por contactarnos, Administradora Obelisco 100% online 😉.";
    }
    await Twilio.sendTextMessageWhatsapp(phoneNumber, msg);
  } catch (error) {
    console.error("Error en sendSaludo:", error);
  }
};

const formatedObject = (obj) => {
  for (let item in obj) {
    obj[item] = obj[item][obj[item].kind];
    if (typeof obj[item] === "object") {
      obj[item] = obj[item].fields;
      formatedObject(obj[item]);
    }
  }
  return obj;
};

const sendKommunicate = async (texto, res) => {
  if (!res || res.headersSent) return;
  let messages = [{ message: texto }];
  return res.status(200).send(messages);
};

module.exports = {
  verifyIntent,
  sendSaludo,
  limpiarSesionRedis,
};
