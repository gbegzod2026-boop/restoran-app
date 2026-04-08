// db.js
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

export async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log("MongoDB ulandi ✔");
  } catch (err) {
    console.error("Mongo ulanish xatosi:", err);
  }
}
