const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = require("./src/app");
const connectDB = require("./src/config/db");
connectDB();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());



app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
