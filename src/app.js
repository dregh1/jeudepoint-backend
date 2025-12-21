const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Routes simples
app.get('/health', (req, res) => res.send('OK'));

module.exports = app;