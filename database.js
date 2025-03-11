const mysql = require('mysql');

// **MySQL Connection Configuration**
const connection = mysql.createConnection({
    host: 'sodatech-instance-1.cbb9xled1g6f.eu-central-1.rds.amazonaws.com',
    user: 'sodatechuser',
    password: 'T!}JjLfRey&+fpE7',
    database: 'pricingDB'
});

// **Connect to MySQL Database**
connection.connect(err => {
    if (err) {
        console.error('Error connecting to MySQL:', err.stack);
        return;
    }
    console.log('Connected to MySQL as id ' + connection.threadId);
});

// **Generate a Simple Custom UUID**
function generateUUID() {
    return 'xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// **Function to Initialize Database (Create Table if Not Exists)**
function initializeDatabase() {
    const checkTableQuery = `
        SELECT COUNT(*) AS tableCount 
        FROM information_schema.tables 
        WHERE table_schema = 'pricingDB' 
        AND table_name = 'pricing';
    `;

    connection.query(checkTableQuery, (err, results) => {
        if (err) {
            console.error('Error checking table existence:', err);
            return;
        }

        const tableExists = results[0].tableCount > 0;
        if (!tableExists) {
            const createTableQuery = `
                CREATE TABLE pricing (
                    PricingID VARCHAR(255) PRIMARY KEY,
                    channel VARCHAR(255),
                    timestamp DATETIME,
                    productAsin VARCHAR(255),
                    productSKU VARCHAR(255),
                    zip VARCHAR(255),
                    SellerName VARCHAR(255),
                    price DECIMAL(10, 2),
                    place VARCHAR(255),
                    lowStock BOOLEAN,
                    action VARCHAR(255)
                );
            `;
            connection.query(createTableQuery, (err, results) => {
                if (err) {
                    console.error('Error initializing database:', err);
                    return;
                }
                console.log('✅ Database initialized with new table structure.');
            });
        } else {
            console.log('✅ Table already exists. No need to create.');
        }
    });
}

// **Function to Append Data to MySQL Database**
function appendToDatabase(data) {
    const insertQuery = 'INSERT INTO pricing SET ?';
    connection.query(insertQuery, data, (err, results) => {
        if (err) {
            console.error('Error while adding new entry to database:', err);
            return;
        }
        console.log('✅ New entry added to database.');
    });
}


// **Function to Read the Database**
function readDatabase(callback) {
    const selectQuery = 'SELECT * FROM pricing';
    connection.query(selectQuery, (err, results) => {
        if (err) {
            console.log('⚠️ Error reading database:', err);
            return callback([]);
        }
        callback(results);
    });
}

// **Close MySQL Connection on Exit**
process.on('exit', () => {
    connection.end();
});

module.exports = {
    initializeDatabase,
    appendToDatabase,
    readDatabase,
    generateUUID
};
