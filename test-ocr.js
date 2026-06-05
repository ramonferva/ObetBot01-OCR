require('dotenv').config();
const axios = require('axios');

const testClaude = async () => {
  console.log("Key:", process.env.CLAUDE_API_KEY?.substring(0, 30) + "...");

  const mensaje = {
  "model": "claude-sonnet-4-6",
  "max_tokens": 500,
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "image",
        "source": {
          "type": "base64",
          "media_type": "image/png",
          "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        }
      },
      {
        "type": "text",
        "text": "¿Qué ves en esta imagen?"
      }
    ]
  }]
};
  
  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', mensaje, {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    });
    
    console.log("✅ Respuesta:", response.data.content[0].text);
  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
    console.error("❌ Error:", err);
  }
};

/*
{
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: 'hola' }]
    }*/
testClaude();