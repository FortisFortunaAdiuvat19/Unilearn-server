const mongoose = require('mongoose');
const dns = require('dns');

// mongodb+srv:// connection strings require a DNS SRV lookup before
// Mongo is ever contacted, and that specific record type is handled
// poorly by a lot of default network DNS resolvers — this is what
// produces "querySrv ECONNREFUSED", which looks like a Mongo connection
// failure but is actually a DNS failure happening one layer earlier.
// Forcing a known-reliable resolver sidesteps this regardless of the
// underlying network's own DNS configuration.
dns.setServers(['1.1.1.1', '8.8.8.8']);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
