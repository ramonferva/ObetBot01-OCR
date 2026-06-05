//const dotenv = require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const apiRouter = require('./routes/index');


const port = 3000;
const app = express();

app.use(express.urlencoded({extended:true}))
app.use(express.json());
app.use(cors());
//app.use('/mediaFiles', express.static(__dirname + '/mediaFiles'));
app.use(apiRouter);


/*
app.all('/webhook', (req, res) => {
  console.log("Body:", req.body);
  //res.send('Hello World webhook')
  console.log("metodo:", req);
  res.status(200).send("webhook activo");
  console.log("tima:", Date());
})*/




const server = http.Server(app);

server.listen(port, ()=> {
    console.log(`Servidor listo en el puerto ${port}`);
})