require('dotenv').config();
const redisClient = require('./config/redis');

async function viewRedisData() {
  try {
    const client = await redisClient();
    
    // Obtener todas las keys
    const keys = await client.keys('*');
    console.log('\n=== DATOS EN REDIS ===\n');
    console.log(`Total de keys: ${keys.length}\n`);
    
    if (keys.length === 0) {
      console.log('No hay datos guardados en Redis');
      await client.quit();
      return;
    }
    
    // Mostrar cada key con su valor
    for (const key of keys) {
      const type = await client.type(key);
      console.log(`Key: "${key}" (tipo: ${type})`);
      
      if (type === 'string') {
        const value = await client.get(key);
        console.log(`  Valor: ${value}`);
      } else if (type === 'hash') {
        const value = await client.hGetAll(key);
        console.log(`  Valor:`, value);
      } else if (type === 'list') {
        const value = await client.lRange(key, 0, -1);
        console.log(`  Valor:`, value);
      } else if (type === 'set') {
        const value = await client.sMembers(key);
        console.log(`  Valor:`, value);
      }
      console.log('');
    }
    
    await client.quit();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

viewRedisData();

