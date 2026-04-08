const mongoose = require("mongoose");

const FoodSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: Number,
    image: String,
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category" }
});

module.exports = mongoose.model("Food", FoodSchema);
