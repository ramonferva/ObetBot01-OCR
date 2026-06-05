const router = require('express').Router();
const messageController = require('../controllers/messages');

//router.get('webhook', messageController.apiVerification);
//router.get('api', "funcionando");
router.post('/webhook', messageController.messageInfo);
//router.post('/webhook', messageController.messageKommunicte);

module.exports = router;