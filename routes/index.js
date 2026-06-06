const router = require('express').Router();
const messageController = require('../controllers/messages');
const redisClient = require('../config/redis');

//router.get('webhook', messageController.apiVerification);
//router.get('api', "funcionando");
router.post('/webhook', messageController.messageInfo);
//router.post('/webhook', messageController.messageKommunicte);

// Endpoint para ver datos de Redis
router.get('/redis-data', async (req, res) => {
  try {
    const client = await redisClient();
    const keys = await client.keys('*');
    
    if (keys.length === 0) {
      return res.json({ message: 'No hay datos en Redis', keys: [] });
    }
    
    const data = {};
    for (const key of keys) {
      const type = await client.type(key);
      
      if (type === 'string') {
        data[key] = await client.get(key);
      } else if (type === 'hash') {
        data[key] = await client.hGetAll(key);
      } else if (type === 'list') {
        data[key] = await client.lRange(key, 0, -1);
      } else if (type === 'set') {
        data[key] = await client.sMembers(key);
      }
    }
    
    res.json({ 
      totalKeys: keys.length,
      keys: keys,
      data: data 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

