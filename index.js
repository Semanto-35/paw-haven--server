const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


// Express App and Middleware Setup
const port = process.env.PORT || 5000;
const app = express();
const cookieParser = require('cookie-parser');

app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://paw-haven-39454.web.app",
    "https://paw-haven-39454.firebaseapp.com",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Origin",
    "X-Requested-With",
    "Accept",
    "x-client-key",
    "x-client-token",
    "x-client-secret",
    "Authorization",
  ],
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())


// MongoDB Database Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gvke0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


// verifyToken
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}





async function run() {
  try {
    const db = client.db('pawAdoptionDb')
    const petsCollection = db.collection('pets')
    const usersCollection = db.collection('users')
    const donationCampaignsCollection = db.collection('donation_campaign')
    const donationCollection = db.collection('donations')
    const requestsCollection = db.collection('adoption_requests')



    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    });

    // Logout/clear cookie from browser
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    });


    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.user?.email
      const query = { email }
      const result = await usersCollection.findOne(query)
      if (!result || result?.role !== 'admin')
        return res
          .status(403)
          .send({ message: 'Forbidden Access! Admin Only Actions!' })

      next()
    }


    // save a user in DB
    app.post('/users/:email', async (req, res) => {
      const email = req.params.email
      const query = { email }
      const user = req.body

      const isExist = await usersCollection.findOne(query)
      if (isExist) {
        return res.send(isExist)
      }
      const result = await usersCollection.insertOne({
        ...user,
        role: 'user',
        isBanned: false,
        timestamp: Date.now(),
      })
      res.send(result);
    });

    // get user role
    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email
      const result = await usersCollection.findOne({ email })
      res.send({ role: result?.role })
    });


    // get all user data by admin
    app.get('/all-users/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email
      const query = { email: { $ne: email } }
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });



    // update a user role by admin
    app.patch('/user/role/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: { role: "admin" },
      }
      const result = await usersCollection.updateOne(filter, updateDoc)
      res.send(result);
    });


    // ban a user by admin 
    app.patch('/user/ban/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: { isBanned: true },
      }
      const result = await usersCollection.updateOne(filter, updateDoc)
      res.send(result);
    });


    // get all pets by search, filtter query new
    app.get('/pets', async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const query = { adopted: false };

      if (req.query.search) {
        query.petName = { $regex: req.query.search, $options: 'i' };
      }

      if (req.query.category) {
        query.petCategory = req.query.category;
      }

      const pets = await petsCollection.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit).toArray();

      const totalPets = await petsCollection.countDocuments(query);
      const totalPages = Math.ceil(totalPets / limit);

      res.send({
        pets,
        currentPage: page,
        totalPages,
        totalPets,
        nextPage: page < totalPages ? page + 1 : null
      })
    });
    // get all pets by search, filtter query old
    // app.get('/pets', async (req, res) => {
    //   const { page = 1, limit = 9, search = "", category = "" } = req.query;
    //   const query = { adopted: false };
    //   if (search) query.petName = { $regex: search, $options: "i" };
    //   if (category) query.petCategory = category;

    //   const pets = await petsCollection.find(query)
    //     .sort({ createdAt: -1 })
    //     .skip((page - 1) * limit)
    //     .limit(Number(limit)).toArray();

    //   const total = await petsCollection.countDocuments(query);
    //   res.send({
    //     pets,
    //     nextPage: page * limit < total ? Number(page) + 1 : null,
    //   })
    // });


    app.get('/stats', verifyToken, async (req, res) => {
      const totalUsers = await usersCollection.countDocuments();
      const totalPets = await petsCollection.countDocuments();
      const totalCampaigns = await donationCampaignsCollection.countDocuments();
      const totalDonations = await donationCollection.aggregate([{ $group: { _id: null, total: { $sum: "$donatedAmount" } } }]).toArray();

      res.send({
        totalUsers,
        totalPets,
        // totalDonations: totalDonations.length ? totalDonations[0].total : 0,
        totalCampaigns,
      })
    });

    // get featured pets
    app.get('/featuredPets', async (req, res) => {
      const result = await petsCollection.find({ adopted: false }).limit(4).toArray();
      res.send(result);
    });

    // get all pets categories
    app.get('/pet-categories', async (req, res) => {
      const result = await petsCollection.aggregate([
        {
          $group: {
            _id: "$petCategory",
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            name: "$_id",
            count: 1,
            _id: 0,
            slug: {
              $toLower: {
                $replaceAll: {
                  input: "$_id",
                  find: " ",
                  replacement: "-"
                }
              }
            }
          }
        },
        {
          $sort: { name: 1 }
        }
      ]).toArray();

      res.send(result);
    });


    // get all pets by admin
    app.get('/all-pets', async (req, res) => {
      const result = await petsCollection.find().toArray();
      res.send(result);
    });


    // get all pets posted by a user
    app.get('/all-pets/:email', verifyToken, async (req, res) => {
      const emails = req.params.email;
      const decodedEmail = req.user?.email
      if (decodedEmail !== emails)
        return res.status(401).send({ message: 'unauthorized access' })
      const query = {
        addedBy: emails
      }
      const result = await petsCollection.find(query).toArray();
      res.send(result);
    });


    // save a pet by user in db
    app.post('/add-pet', verifyToken, async (req, res) => {
      const petData = req.body;
      const result = await petsCollection.insertOne(petData)
      res.send(result);
    });


    // get a pet by id
    app.get('/pets/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await petsCollection.findOne(query)
      res.send(result);
    });


    // update and then save a pet by id
    app.put('/update-pet/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const formData = req.body;
      const updatedDoc = {
        $set: formData,
      }
      const filter = { _id: new ObjectId(id) }
      const options = { upsert: true }
      const result = await petsCollection.updateOne(filter, updatedDoc, options);
      res.send(result);
    });


    // update a pet adoption status
    app.patch('/pet/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: { adopted: status },
      }
      const result = await petsCollection.updateOne(filter, updateDoc)
      res.send(result);
    });

    // delete a pet by id
    app.delete('/pet/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await petsCollection.deleteOne(query);
      res.send(result);
    });

    // create a donation campaign
    app.post('/donation-campaigns', verifyToken, async (req, res) => {
      const campaignData = req.body;
      const campaigns = {
        ...campaignData,
        createdAt: new Date(),
        currentDonation: 0,
        isPaused: false,
        donors: 0,
      }
      const result = await donationCampaignsCollection.insertOne(campaigns)
      res.send(result);
    });


    // get all donation campaign created by a user
    app.get('/all-campaigns/:email', verifyToken, async (req, res) => {
      const emails = req.params.email;
      const decodedEmail = req.user?.email
      if (decodedEmail !== emails)
        return res.status(401).send({ message: 'unauthorized access' })
      const query = {
        addedBy: emails
      }
      const result = await donationCampaignsCollection.find(query).toArray();
      res.send(result);
    });


    // get all donation campaigns by admin
    app.get('/all-campaigns', async (req, res) => {
      const result = await donationCampaignsCollection.find().toArray();
      res.send(result);
    });

    // get featured campaigns
    app.get('/featuredCampaigns', async (req, res) => {
      const today = new Date().toISOString().split('T')[0];
      const result = await donationCampaignsCollection.find({ lastDate: { $gte: today } }).limit(4).sort({ lastDate: 1 }).toArray();

      res.send(result);
    });

    // get 3 donation campaigns 
    app.get('/limited-campaigns', async (req, res) => {
      const { id } = req.query;
      const today = new Date().toISOString().split('T')[0];
      const result = await donationCampaignsCollection.find({ lastDate: { $gte: today }, _id: { $ne: new ObjectId(id) } }).sort({ lastDate: 1 }).limit(3).toArray();
      res.send(result);
    });



    // get all donation campaigns by sorting , scrolling
    app.get('/allCampaigns', verifyToken, async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = 6;
      const skip = (page - 1) * limit;

      const campaigns = await donationCampaignsCollection.find().sort({ createdAt: -1 }).skip(skip)
        .limit(limit).toArray();
      const totalCampaigns = await donationCampaignsCollection.countDocuments();

      res.send({
        campaigns,
        currentPage: page,
        hasMore: skip + campaigns.length < totalCampaigns,
        nextPage: page + 1,
      });
    });


    // get a donation campaigns by id
    app.get('/donation-campaigns/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await donationCampaignsCollection.findOne(query)
      res.send(result);
    });


    // update and then save a donation campaign by id
    app.put('/update-campaign/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const formData = req.body;
      const updatedDoc = {
        $set: formData,
      }
      const filter = { _id: new ObjectId(id) }
      const options = { upsert: true }
      const result = await donationCampaignsCollection.updateOne(filter, updatedDoc, options);
      res.send(result);
    });


    // update a pet donation status in donation campaign
    app.patch('/donation-campaigns/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }
      const campaign = await donationCampaignsCollection.findOne(filter);
      const isPaused = campaign.isPaused;
      const updateDoc = {
        $set: { isPaused: !isPaused },
      }
      const result = await donationCampaignsCollection.updateOne(filter, updateDoc)
      res.send(result);
    });


    // update a pet donation in donation campaign
    app.patch('/donated-camp/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const { totalDonation, donors } = req.body
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          currentDonation: totalDonation,
          donors,
        },
      }
      const result = await donationCampaignsCollection.updateOne(filter, updateDoc)
      res.send(result);
    });


    // delete a donation campaign by admin
    app.delete('/donation-campaign/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await donationCampaignsCollection.deleteOne(query);
      res.send(result);
    });


    // payment intent
    // app.post('/create-payment-intent', verifyToken, async (req, res) => {
    //   const { donatedAmount } = req.body;

    //   if (!donatedAmount || isNaN(donatedAmount)) {
    //     return res.status(400).json({ error: "Invalid donation amount" });
    //   }

    //   try {
    //     const amount = Math.round(donatedAmount * 100);

    //     const paymentIntent = await stripe.paymentIntents.create({
    //       amount: amount,
    //       currency: 'usd',
    //       payment_method_types: ['card'],
    //     });

    //     res.send({ clientSecret: paymentIntent.client_secret });
    //   } catch (error) {
    //     console.error("Error creating payment intent:", error);
    //     res.status(500).json({ error: "Internal Server Error" });
    //   }
    // });

    // improved payment intent
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const { donatedAmount, campaignId } = req.body;

      // Validate amount
      if (!donatedAmount || isNaN(donatedAmount) || donatedAmount <= 0) {
        return res.status(400).json({ error: "Invalid donation amount" });
      }

      try {
        // Get campaign to check max donation
        const campaign = await donationCampaignsCollection.findOne({ _id: new ObjectId(campaignId) });
        if (!campaign) {
          return res.status(404).json({ error: "Campaign not found" });
        }

        // Check if donation would exceed max
        if (campaign.currentDonation + parseFloat(donatedAmount) > campaign.maxDonation) {
          return res.status(400).json({
            error: `Donation would exceed campaign maximum. Maximum remaining: $${campaign.maxDonation - campaign.currentDonation}`
          });
        }

        const amount = Math.round(donatedAmount * 100);
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: 'usd',
          payment_method_types: ['card'],
          metadata: { campaignId: campaignId.toString() }
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });



    // save a donation in a donation campaigns 
    app.post('/donations', verifyToken, async (req, res) => {
      const donationData = req.body;
      const result = await donationCollection.insertOne(donationData)
      res.send(result);
    });


    // get all donations created in a donation campaigns
    app.get('/donationCampaign/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const query = { campaignId: id }
      const result = await donationCollection.find(query).toArray();
      res.send(result);
    });



    // get all donations created by a user
    app.get('/donations/:email', verifyToken, async (req, res) => {
      const emails = req.params?.email;
      const decodedEmail = req.user?.email
      if (decodedEmail !== emails)
        return res.status(401).send({ message: 'unauthorized access' })
      const query = {
        donorEmail: emails
      }
      const result = await donationCollection.find(query).toArray();
      res.send(result);
    });


    // delete my donated money from my donations
    app.delete('/delete-donation/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await donationCollection.deleteOne(query);
      res.send(result);
    });


    // refund my money from a donation campaign
    app.patch('/refundMoney/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const { money } = req.body
      const filter = { _id: new ObjectId(id) }

      const campaign = await donationCampaignsCollection.findOne(filter);
      if (!campaign) {
        return res.status(404).send({ message: "Campaign not found" });
      }
      const newAmount = campaign.currentDonation - money;

      const updateDoc = {
        $set: {
          currentDonation: newAmount
        },
      }
      const result = await donationCampaignsCollection.updateOne(filter, updateDoc)
      res.send(result);
    });


    // make a adoption request
    app.post('/adopted-pet', verifyToken, async (req, res) => {
      const campaignData = req.body;
      const result = await requestsCollection.insertOne(campaignData)
      res.send(result);
    });


    // get all pets request adopt by a user
    app.get('/adopted-pet/:email', verifyToken, async (req, res) => {
      const emails = req.params.email;
      const decodedEmail = req.user?.email
      if (decodedEmail !== emails)
        return res.status(401).send({ message: 'unauthorized access' })
      const query = {
        addedBy: emails
      }
      const result = await requestsCollection.find(query).toArray();
      res.send(result);
    });









    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    //   await client.db("admin").command({ ping: 1 });
    //   console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



// Start Server
app.get('/', (req, res) => {
  res.send('Paw Haven is adopting pets')
});

app.listen(port, () => {
  console.log(`Paw Haven website is running in port: ${port}`);
});