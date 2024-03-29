import express from 'express'
import sqlite3 from 'sqlite3'
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import fs from 'fs';
import dig from 'node-dig-dns';

// set up express web server
const app = express()
app.use(express.static('public'))
app.set('view engine', 'ejs')

// set up S3 client
const S3 = new S3Client({
  region: "auto",
  endpoint: `https://fly.storage.tigris.dev`,
});


const appName = process.env.FLY_APP_NAME;
const bucketName = process.env.BUCKET_NAME;
const customerId = process.env.CUSTOMER_ID || 0;
const databasePath = process.env.DATABASE_PATH || "./db.sqlite3";
const databaseKey = `/customer/${customerId}/db.sqlite3`;

// If the db file exists in the S3 bucket, download it to the local filesystem
const checkDbInS3 = async () => {
  try {
    const { Body } = await S3.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: databaseKey
    }));

    fs.writeFileSync(databasePath, await Body.transformToByteArray());

    console.log("Successfully downloaded the db file from S3.");
  } catch (error) {
    if (error.Code == "NoSuchKey") {
      console.log("Db file not found in S3, one will be created locally.");
    } else
      console.error("Failed to download the db file from S3:", error);
  }
};

// Send the db file to the S3 bucket and terminate
const sendDbToS3 = async () => {
  try {
    const fileContent = fs.readFileSync(databasePath);

    await S3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: databaseKey,
      Body: fileContent
    }));

    console.log("Successfully sent the db file to S3.");
    process.exit(0);
  } catch (error) {
    console.error("Failed to send the db file to S3:", error);
    process.exit(1);
  }
};

// Delete the db file from the S3 bucket
const deleteDbFromS3 = async () => {
  try {
    await S3.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: databaseKey
    }));

    console.log("Successfully deleted the db file from S3.");
  } catch (error) {
    console.error("Failed to delete the db file from S3:", error);
  }
}

const setupDb = async () => {
  // Send the db file to S3 and terminate the process on SIGINT and SIGTERM
  process.on("SIGINT", sendDbToS3);
  process.on("SIGTERM", sendDbToS3);

  if (process.env.RESET_DB) {
    deleteDbFromS3();
    fs.unlinkSync(databasePath);
  }
  else {
    checkDbInS3();
  }
}


const get_machine_id = async (customerId) => {
  if (!appName) { return "abcd1234" };

  try {
    const ip = await dig([`${customerId}.customer_id.kv._metadata.${appName}.internal`, 'aaaa', '+short'])
    const addr = await dig(['+short', '-x', ip]);
    return addr.split('.')[0];
  } catch (error) {
    console.log(`Error getting machine id for ${customerId}`, error)
  }
};

// set up sqlite database
const db = new sqlite3.Database(databasePath)
setupDb();

// last known count
let count = 0

// Main page
app.get(`/customers/${customerId}`, async (request, response) => {
  // increment count, creating table row if necessary
  await new Promise((resolve, reject) => {
    console.log(`[worker] Received request for customer: ${customerId}`)
    db.get('SELECT "count" from "welcome"', (err, row) => {
      let query = 'UPDATE "welcome" SET "count" = ?'

      if (err) {
        reject(err)
        return
      } else if (row) {
        count = row.count + 1
      } else {
        count = 1
        query = 'INSERT INTO "welcome" VALUES(?)'
      }

      db.run(query, [count], err => {
        err ? reject(err) : resolve()
      })
    })
  })

  // render HTML response
  response.render('index', { count });
});
// Router
app.get(`/customers/:customerId`, async (request, response) => {
  console.log(`[router] Received request for customer: ${request.params.customerId}`)
  let machineId = await get_machine_id(request.params.customerId);
  if (machineId) {
    console.log(`[router] Forwarding request to machine: ${machineId}`);
    response.set('fly-replay', `instance=${machineId}`).send();
  } else {
    console.error(`[router] Machine not found for customer: ${request.params.customerId}`);
    response.status(404).send("Not found");
  }
})


// Ensure welcome table exists
db.run('CREATE TABLE IF NOT EXISTS "welcome" ( "count" INTEGER )')

// Start web server on port 3000
app.listen(3000, () => {
  console.log('Server is listening on port 3000, serving customer_id:', customerId)
})
