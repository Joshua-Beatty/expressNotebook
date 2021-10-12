const bcrypt = require('bcrypt');
module.exports = (db) => {
    // eslint-disable-next-line no-unused-vars
    return new Promise((resolve, _reject) => {
        db.exec(`CREATE TABLE IF NOT EXISTS "clients" (
            "clientID"	TEXT UNIQUE,
            "clientKey"	INTEGER UNIQUE,
            "clientName"	INTEGER,
            "userID"	INTEGER
        )`);
        db.exec(`CREATE TABLE IF NOT EXISTS "messages" (
            "messageID"	INTEGER,
            "timeStamp"	INTEGER,
            "messageText"	TEXT,
            "messageFilePath"	TEXT,
            "clientID"	TEXT,
            "userID"	TEXT,
            PRIMARY KEY("messageID" AUTOINCREMENT)
        )`);
        db.exec(`CREATE TABLE IF NOT EXISTS "users" (
            "username"	TEXT UNIQUE,
            "password"	TEXT,
            "userID"	TEXT,
            "userType"	INTEGER
        )`);

        db.get('SELECT * FROM users WHERE userType = 0').then((result) => {
            if (!result) {
                console.log("Creating admin user.....");
                var readline = require("readline");
                let rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                rl.question('Enter admin username: ', name => {
                    var username = name;
                    rl.close();

                    let r2 = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });

                    r2.input.on("keypress", function () {
                        readline.moveCursor(r2.output, -2, 0);
                        readline.clearLine(r2.output, 1);
                        r2.output.write(" ");
                    });
                    getPassword(r2, (password) => {
                        bcrypt.hash(password, 10, function (_err, hash) {
                            const { v4: uuidv4 } = require('uuid');
                            db.run('INSERT INTO users (username, password, userID, userType) VALUES (:username, :password, :userID, :userType)',
                                {
                                    ":username": username,
                                    ":password": hash,
                                    ":userID": uuidv4(),
                                    ":userType": 0
                                });
                            console.log();
                            resolve();
                        });
                    });
                });
            } else {
                resolve();
            }
        });


    });
};


function getPassword(readline, callback, notFirst) {
    if (notFirst) {
        console.log("Your passwords do not match try again");
    }
    readline.question("Enter your new password: ", function (pw) {
        // pw == the user's input:
        var password = pw;
        readline.question("Enter your new password again:  ", function (pw2) {
            if (password == pw2) {
                readline.close();
                callback(password);
            } else {
                getPassword(readline, callback, true);
            }
        });
    });

}


if (!module.parent) {
    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');
    const path = require('path');
    (async () => {
        const db = await open({
            filename: path.join(__dirname, 'messages.db'),
            driver: sqlite3.Database
        });
        await module.exports(db);
    })();
}