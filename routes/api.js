const { response } = require("express");
const http = require("http");
//const https = require("https");
const axios = require("axios").default;

const host = "obelisco.com.ve";
const port = "";
const path = "/obe/api";
//let web = "http://172.16.1.6:9091/api";
let web = "http://"+host+":"+port+path;
//let web = "https://obelisco.com.ve/obe/api";

async function getCodigo(codigo) {
  let registro = "";

  return new Promise((resolve, reject) => {
    http.get( web +"/info/" + codigo, (res) => {
      let data = "";
      res.on("data", (d) => {
        data += d;
      });
      res.on("end", () => {
        if (res.statusCode==200){
          resolve(data);
          console.log(data);
          registro = data;
        }else{
          reject("error");
          console.log(res.statusCode);
        }        
      });
    });
  });

  return registro;
}

async function getPhone(phone) {
  const datos = new Promise((resolve, reject) => {
    http.get( web + "/infod/+" + phone, (res) => {
      let data = "";
      res.on("data", (d) => {
        data += d;
      });
      res.on("end", () => {        
        if (res.statusCode == 200) {
          resolve(data);         
        } else {
          reject("error", res.statusCode);          
        }      
      });
      
    });
  });
  console.log(datos);
  return datos;
}

async function setDeposito(data) {
  console.log("deposito recibido :" + data);
  const options = {
    hostname: host,
    port: port,
    path: path+"/depo/nuevo",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": data.length,
    },
    
  };
  const datos = new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let result = "";
      res.on("data", (d) => {
        result += d;        
      });
      res.on("end", () => {
        if (res.statusCode == 200) {
          resolve(result);
          console.log(result);
        } else {
          reject("error");
          console.log(res.statusCode);
        }
        //Llamar a un Callback o resolver la promera aquí.
      });
    });
    req.on("error", (err) => {
      console.log("Error: " + err.message);
    });
    //write data to request body
    req.write(data);
    //to signify the end of the request - even if there is no data being written to the request body.
    req.end();
  });
  console.log(datos);
  return datos;
}

async function setTransferencia(data) {

  console.log("transferencia recibida :" + data);
  const options = {
    hostname: host,
    port: port,
    path: path+"/transf/nuevo",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": data.length,
    },
    
  };
  const datos = new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let result = "";
      //status code of the request sent
      console.log("statusCode: ", res.statusCode);
      res.on("data", (d) => {
        result += d;        
      });
      res.on("end", () => {
        if (res.statusCode == 200) {
          resolve(result);
          console.log(result);
        } else {
          reject("error");
          console.log(res.statusCode);
        }
        //Llamar a un Callback o resolver la promera aquí.
      });
    });
    req.on("error", (err) => {
      console.log("Error: " + err.message);
    });
    //write data to request body
    req.write(data);
    //to signify the end of the request - even if there is no data being written to the request body.
    req.end();
  });
  console.log(datos);
  return datos;
}

function getSumNum(a, b) {
  const customPromise = new Promise((resolve, reject) => {
    const sum = a + b;

    if (sum <= 5) {
      resolve("Let's go!!");
    } else {
      reject(new Error("Oops!.. Number must be less than 5"));
    }
  });

  return customPromise;
}

async function addDeposito(data) {

  let depo = {
    codigo: data.codigo,
    cuenta: data.cuenta,
    fecha: data.fecha,
    documento: data.documento,
    monto: data.monto,
  };

  depo = JSON.stringify(depo);

  try {
    const response = await axios.post(web+"/depo/nuevo", depo);
    console.log(response);
  } catch (error) {
    console.error(error);
  }
}


async function addTransferencia(data) {

  let transf = {
    codigo: data.codigo,
    banco : data.banco,
    cuenta: data.cuenta,
    fecha: data.fecha,
    documento: data.documento,
    monto: data.monto,
  };

  transf = JSON.stringify(transf);

  try {
    const response = await axios.post(web+"/transf/nuevo", transf);
    console.log(response);
  } catch (error) {
    console.error(error);
  }
}

async function getReciboCondominio(data) {
  var codigo = data['codigo'];
  var fecha = data['fecha'];
  const datos = new Promise((resolve, reject) => {
    http.get( web + "/reccdo/+" + codigo+"/"+fecha, (res) => {
      let data = "";
      res.on("data", (d) => {
        data += d;
      });
      res.on("end", () => {        
        if (res.statusCode == 200) {
          resolve(data);         
        } else {
          reject("error", res.statusCode);          
        }      
      });
      
    });
  });
  console.log(datos);
  return datos;
}

module.exports = {
  getCodigo,
  getPhone,
  setDeposito,
  setTransferencia,
  addDeposito,
  addTransferencia,
  getReciboCondominio

};
