const express = require('express');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.static('./dist'));
app.get('/*', (req, res) =>
  res.sendFile('index.html', { root: 'dist/' }),
);

const server = require('http').createServer(app);
const io = require('socket.io')(server);
io.on('connection', (client) => {

  client.on('log_initialise', () => {
    console.log('log_initialise');
    headMeasures = new Object();
  });  

  client.on('log_appendData', (data) => {
    for (const [key, value] of Object.entries(data)) {
      if (!Object.keys(headMeasures).includes(key)) {
        headMeasures[key] = [];
      }
      headMeasures[key].push(value);
    }
  });
  
  client.on('log_stopAndSave', (filename) => {
    console.log('log_stopAndSave');
    let fn = filename != null ? filename : uuidv4();
    fs.writeFileSync(`./${fn}.json`, JSON.stringify(headMeasures));
  });

});
server.listen(process.env.PORT || 8080);
