const client = require('twilio')(accountSid, authToken);
require('dotenv').config();

const accountSid   = process.env.accountSid
const authToken    = process.env.authToken


function sendTextMessageWhatsapp(phone, message) {
    return new Promise((resolve, reject) => {
      client.messages
        .create({
          from: "whatsapp:+13235151219",
          body: message,
          to: formatPhone(phone),
        })
        // BUG CORREGIDO: antes era `.then((message) => resolve)` — resolve nunca se llamaba
        .then((message) => resolve(message))
        .catch((err) => reject(err));
    });
}
 
function sendTextMessageWhatsappSid(phone, contentSid) {
    console.log("contentSid -> ", contentSid);
    return new Promise((resolve, reject) => {
      client.messages
        .create({
          from: "whatsapp:+13235151219",
          to: formatPhone(phone),
          messagingServiceSid: "MG076e45c5d32218ddf25d8f092cd1ef00",
          contentSid: contentSid,
        })
        // BUG CORREGIDO: antes era `.then((contentSid) => resolve)` — resolve nunca se llamaba
        .then((result) => resolve(result))
        .catch((err) => {
          console.log("Twilio -> ", err);
          reject(err);
        });
    });
}
 
function sendTextMessageWhatsappSidMsg(phone, message, contentSid) {
  console.log(message);
  return new Promise((resolve, reject) => {
    client.messages
      .create({
        from: "whatsapp:+13235151219",
        to: formatPhone(phone),
        messagingServiceSid: "MG076e45c5d32218ddf25d8f092cd1ef00",
        contentSid: contentSid,
        contentVariables: JSON.stringify(message),
      })
      // BUG CORREGIDO: antes era `.then((message) => resolve)` — resolve nunca se llamaba
      .then((result) => resolve(result))
      .catch((err) => reject(err));
  });
}
 
function sendTextMessageWhatsappSidMsgN(phone, message, contentSid, js) {
  console.log(js);
  return new Promise((resolve, reject) => {
    client.messages
      .create({
        from: "whatsapp:+13235151219",
        messagingServiceSid: "MG076e45c5d32218ddf25d8f092cd1ef00",
        to: formatPhone(phone),
        contentSid: contentSid,
        contentVariables: JSON.stringify(js),
      })
      // BUG CORREGIDO: antes era `.then((message) => resolve)` — resolve nunca se llamaba
      .then((result) => resolve(result))
      .catch((err) => reject(err));
  });
}

/**
 * Asegura que el número tenga el prefijo whatsapp:
 * Twilio requiere que from y to sean del mismo canal.
 * Ej: "+584122724600" → "whatsapp:+584122724600"
 */
const formatPhone = (phone) => {
  if (!phone) return phone;
  return phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
};


module.exports = {
  sendTextMessageWhatsapp,
  sendTextMessageWhatsappSid,
  sendTextMessageWhatsappSidMsg,
  sendTextMessageWhatsappSidMsgN
};
