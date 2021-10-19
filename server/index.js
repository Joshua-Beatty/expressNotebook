const express = require('express');
const fileUpload = require('express-fileupload');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');
(async() => {
    let subscribers = {};
    // open the database
    const db = await open({
        filename: path.join(__dirname, 'messages.db'),
        driver: sqlite3.Database,
    });
    // Set up database on first run
    await require('./db-setup.js')(db);

    // set up express vars
    const app = express();
    const port = process.env.PORT || 8080;

    // Set up middle ware and static files folder
    app.use(fileUpload());
    app.use(express.json());
    app.use('/files', express.static('files'));

    // main upload messages and files route
    app.post('/upload', async(req, res) => {
        const user = await verify(req);
        if (!user) return res.status(401).send({ status: 401, msg: 'Bad Authentication' });
        const timestamp = Date.now();
        // If text is sent save it as one message
        if (req.body && req.body.textField) {
            await db.run('INSERT INTO messages(timeStamp, messageText, clientID, userID) VALUES(:timeStamp, :messageText, :clientID, :userID)', {
                ':timeStamp': timestamp,
                ':messageText': req.body.textField,
                ':clientID': user.clientID,
                ":userID": user.userID,
            });
        }
        // If no file attatched then stop
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.send({ status: 200, msg: 'message uploaded' });
        }

        // If file is sent save it as another message
        const fileID = uuidv4();
        // The name of the input field (i.e. "fileUpload") is used to retrieve the uploaded file
        const file = req.files.fileUpload;
        const uploadPath = path.join(__dirname, `/files/${fileID}/${file.name}`);
        fs.mkdir(path.join(__dirname, `/files/${fileID}/`), { recursive: true }, (err) => {
            if (err) throw err;
        });
        // Use the mv() method to place the file on the file system
        file.mv(uploadPath, async(err) => {
            if (err) return res.status(500).send(err);
            // Add file to database
            await db.run('INSERT INTO messages VALUES(null, :timeStamp, :messageText, :messageFilePath, :clientID, :userID)', {
                ':timeStamp': timestamp,
                ':messageText': file.name,
                ':messageFilePath': `/files/${fileID}/${file.name}`,
                ':clientID': user.clientID,
                ":userID": user.userID,
            });
            return res.send({ status: 200, msg: 'message uploaded' });
        });
    });

    //Get limit number of messages older then offset
    //Used for getting old messages(like on scroll up)
    app.get('/messages', async(req, res) => {
        const user = await verify(req);
        if (!user) res.status(401).send({ status: 401, msg: 'Bad Authentication' });
        if (req.query.limit > 100) req.query.limit = 100;
        const result = await db.all('SELECT * FROM messages WHERE messageID < :offset AND userID = :userID ORDER BY timeStamp DESC LIMIT :number  ', {
            ':number': req.query.limit || 10,
            ':offset': req.query.offset || 9223372036854775807n,
            ':userID': user.userID,
        });
        res.send({ status: 200, results: result, offset: (result.length > 0 ? result[result.length - 1].messageID : (req.query.offset || 1)) });
    });

    //Get limit number of messages newer then offset
    //Used for pinging for new messages
    app.get('/messages/new', async(req, res) => {
        const user = await verify(req);
        if (!user) res.status(401).send({ status: 401, msg: 'Bad Authentication' });
        if (req.query.limit > 100) req.query.limit = 100;
        const result = await db.all('SELECT * FROM messages WHERE messageID > :offset AND userID = :userID ORDER BY messageID ASC LIMIT :number ', {
            ':number': req.query.limit || 10,
            ':offset': req.query.offset || 0,
            ':userID': user.userID,
        });
        res.send({ status: 200, results: result, offset: (result.length > 0 ? result[result.length - 1].messageID : (req.query.offset || 9223372036854775807n)) });
    });

    //Deletes a message and the corresponding file if there is any
    app.delete('/messages/delete/:messageID', async(req, res) => {
        const user = await verify(req);
        if (!user) res.status(401).send({ status: 401, msg: 'Bad Authentication' });
        const result = await db.get('SELECT * FROM messages WHERE messageID = :messageID AND userID = :userID', {
            ':messageID': req.params.messageID,
            ':userID': user.userID,
        });
        if (!result) {
            res.status(400).send({ status: 400, msg: `Could not find or delete: ${req.params.messageID}` });
            return;
        }
        if (result.messageFilePath) {
            console.log(result.messageFilePath);
            fs.rmdirSync(path.join(__dirname, path.dirname(result.messageFilePath)), { recursive: true });
        }
        const result2 = await db.run('DELETE FROM messages WHERE messageID = :messageID ', {
            ':messageID': req.params.messageID,
        });
        if (result2.changes == 1) {
            res.send({ status: 200, msg: `Deleted: ${req.params.messageID}` });
        } else {
            res.status(400).send({ status: 400, msg: `Could not find or delete: ${req.params.messageID}` });
        }
    });

    app.post('/clients/new', async(req, res) => {
        if (!req.body.username || !req.body.password || !req.body.clientName) {
            res.status(400).send({ status: 400, msg: 'request must contain body key values: \'username\', \'password\', and \'clientName\'' });
            return;
        }
        const user = await db.get('SELECT * FROM users WHERE username = ?', req.body.username);
        bcrypt.compare(req.body.password, user.password, async(err, result) => {
            if (result) {
                const clientKey = uuidv4();
                const clientID = uuidv4();
                await db.run('INSERT INTO clients (clientID, clientKey, clientName, userID) VALUES (:clientID, :clientKey, :clientName, :userID)', {
                    ':clientID': clientID,
                    ':clientKey': clientKey,
                    ':clientName': req.body.clientName,
                    ':userID': user.userID,
                });
                res.send({
                    status: 200,
                    name: req.body.clientName,
                    clientID,
                    clientKey,
                });
            } else {
                res.status(422).send({ status: 422, msg: 'Bad Credentials' });
            }
        });
    });

    app.delete('/clients/delete/:clientID', async(req, res) => {
        if (!req.body.username || !req.body.password) {
            res.status(400).send({ status: 400, msg: 'request must contain body params: \'username\' and \'password\'' });
            return;
        }
        const user = await db.get('SELECT * FROM users WHERE username = ?', req.body.username);
        bcrypt.compare(req.body.password, user.password, async(err, result) => {
            if (result) {
                const result2 = await db.run('DELETE FROM clients where clientID = :clientID ', {
                    ':clientID': req.params.clientID,
                });
                if (result2.changes == 1) {
                    res.send({ status: 200, msg: `Deleted: ${req.params.clientID}` });
                } else {
                    res.status(400).send({ status: 400, msg: `Could not delete or find: ${req.params.clientID}` });
                }
            } else {
                res.status(422).send({ status: 422, msg: 'Bad Credentials' });
            }
        });
    });

    app.get("/subscribe", async(req, res) => {
        const user = await verify(req);
        if (!user) return res.status(401).send({ status: 401, msg: 'Bad Authentication' });
        if(!subscribers[user.userID])
            subscribers[user.userID] = {};
        let id = uuidv4();

        subscribers[user.userID][id] = res;

        res.set({
            'Cache-Control': 'no-cache',
            'Content-Type': 'text/event-stream',
            'Connection': 'keep-alive'
        });
        res.flushHeaders();

        res.socket.on('end', () => {
            res.end();
            delete subscribers[user.userID][id];
            if(Object.keys(subscribers[user.userID]).length === 0)
             delete subscribers[user.userID];
            console.log(subscribers);
        });

        res.write(`connected\n`);

    });
    app.listen(port, (err) => {
        if (err) console.log('Error in server setup');
        console.log(`Server started at http://localhost:${port}`);
    });

    async function verify(req) {
        if (!req) {
            return false;
        }
        const result = await db.get('SELECT * FROM clients WHERE clientKey = ?', req.get('clientKey'));
        console.log(1);
        console.log(req.get('clientKey'));
        console.log(result);
        if (!req.get('clientKey') || !result) return false;
        console.log(2);
        return result;
    }
})();