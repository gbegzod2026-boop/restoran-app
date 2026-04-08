import mongoose from "mongoose";

const MenuSchema = new mongoose.Schema({
  name: String,
  price: Number,
  category: String,
  subcategory: String,
  img: String,
  hidden: Boolean
});

export default mongoose.model("Menu", MenuSchema);
