import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema({
  id: String,
  table: Number,
  item: {
    name: String,
    price: Number,
    img: String
  },
  status: String, // pending, preparing, ready, delivered
  createdAt: Number
});

export default mongoose.model("Order", OrderSchema);
