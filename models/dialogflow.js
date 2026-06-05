const dialogflow = require("@google-cloud/dialogflow");
//const Messages = require('./messages');
//const Redis = require('../config/redis');
const DIALOGFLOW_ACCOUNT_PATH = `${__dirname}/../config/dialogflow-account.json`;
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

require('dotenv').config();

const project_id   = process.env.project_id
const private_key    = process.env.private_key
const client_email    = process.env.client_email


/* const getDialogflowCredentials = () => {
  if (!fs.existsSync(DIALOGFLOW_ACCOUNT_PATH)) return null;
  const credentials = fs.readFileSync(DIALOGFLOW_ACCOUNT_PATH);
  if (!credentials) return null;

  const parseCredentials = JSON.parse(credentials);

  return parseCredentials;
}; */

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

const dialogflowProccess = async (message, phoneNumber, messageId) => {
  console.log("dialogflow ----> ", message);
  try {
    //const redis = await Redis();
    //const sessionId = uuidv4();
    const sessionId = messageId;
    //const credentialsDF = getDialogflowCredentials();
    //const { project_id, private_key, client_email } = credentialsDF;
    const configuration = {
      credentials: {
        private_key,
        client_email,
      },
    };
    const sessionClient = new dialogflow.SessionsClient(configuration);
    const sessionPath = sessionClient.projectAgentSessionPath(
      project_id,
      sessionId
    );
    const requestPayload = {
      session: sessionPath,
      queryInput: {
        text: {
          text: message,
          languageCode: "es",
        },
      },
    };
    /*
    const contextKey = `${phoneNumber}:context`;
    const redisContext = await redis.get(contextKey);
        if(redisContext){
            requestPayload.queryParams = {
                contexts:[{
                    name: redisContext,
                    lifespanCount: 5
                }]
            }
        }
            */
    const response = await sessionClient.detectIntent(requestPayload);
    //console.log("Intent: ", JSON.stringify(response));
    //console.log("Intent: ", response);
    const queryResult = response[0].queryResult;
    const outputContexts = queryResult.outputContexts;

    /*
    if (queryResult.outputContexts[0]) {
      const newContext = queryResult.outputContexts[0].name;
      await redis.set(contextKey, newContext);
      await redis.expire(contextKey, 60)
    } else {
      await redis.del(contextKey);
    }*/

    const receiveMessage = queryResult.fulfillmentText;
    const fulfillmentMessages = queryResult.fulfillmentMessages;

    let attachment = fulfillmentMessages.find(
      (items) => items.message === "payload"
    );

    const options = {
      text: receiveMessage,
      phoneNumber,
      messageId,
      action : queryResult.action,
      outputContexts : outputContexts,
      allRequiredParamsPresent : queryResult.allRequiredParamsPresent,
      type: "text",

    };

    
    if (attachment) {
      let fields = attachment.payload.fields;      
      fields = formatedObject(fields);
     
      const {
        reply,
        hasUrl,
        type,
        document,
        contact,
        location,
        listPayload,
        buttonPayload,
        metadata,
        platform,
        assign,

      } = fields;
      options.document = document;
      options.location = location;
      options.metadata = metadata;
      options.platform = platform; 
      options.assign = assign;   
      options.type = type ? type : "text"; 
      
    }

    //Twilio.sendTextMessageWhatsapp(phoneNumber, receiveMessage);
    console.log("DialogFlow options", options);
    return options;
  } catch (error) {
    console.log("Error ", error);
    throw new Error(error);
  }
};

module.exports = { dialogflowProccess };
