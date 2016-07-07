var express = require('express');
var server = require('./server');

var app = express();
app.use('/api/', server);

app.listen(8080, function() {
    console.log('server listening');
});