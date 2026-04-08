require('dotenv').config();
const { connect } = require('./db');
const Category = require('./models/Category');
const Food = require('./models/Food');
const Staff = require('./models/Staff');

async function seed() {
  await connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/foodify');
  await Category.deleteMany({});
  await Food.deleteMany({});
  await Staff.deleteMany({});

  const cats = await Category.insertMany([
    {name:'Asosiy taomlar'},
    {name:'Gazaklar'},
    {name:'Sho\'rvalar'},
    {name:'Fast-food'},
    {name:'Garnirlar'},
    {name:'Ichimliklar'},
    {name:'Desertlar'},
    {name:'Non mahsulotlari'},
    {name:'Maxsus kategoriyalar'}
  ]);

  await Food.insertMany([
    {name:'Plov', category:cats[0]._id, price:28000},
    {name:'Olivye', category:cats[1]._id, price:15000},
    {name:'Mastava', category:cats[2]._id, price:18000},
    {name:'Burger', category:cats[3]._id, price:30000},
  ]);

  await Staff.insertMany([{name:'Azizbek', role:'chef'},{name:'Malika', role:'waiter'}]);

  console.log('Seed done');
  process.exit(0);
}

seed();
