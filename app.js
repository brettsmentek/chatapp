'use strict';

// Setup basic express server
var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var port = process.env.PORT || 3000;

var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('./data/db.sqlite');

var validator = require('validator');

server.listen(port, function () {
  console.log('Server listening at port %d', port);
});

// Routing
app.use(express.static(__dirname + '/public'));

// Chatroom

// usernames which are currently connected to the chat
var usernames = {};
var numUsers = 0;

io.on('connection', function (socket) {
  var addedUser = false;

  // when the client emits 'new message', this listens and executes
  socket.on('new message', function (data) {
    var data = validator.escape(data);
    // we tell the client to execute 'new message'
    socket.broadcast.emit('new message', {
      username: socket.username,
      message: data
    });
    db.serialize(function() {
      console.log('inserting message to database');
      var insertMessageStr = "INSERT INTO messages (username, content, posted) VALUES ('" + socket.username + "','" + data.toString() + "'," + Date.now() + ");"
      console.log(insertMessageStr)
      db.run(insertMessageStr);
    });
  });

  // when the client emits 'add user', this listens and executes
  socket.on('add user', function (username) {
    // we store the username in the socket session for this client
    socket.username = validator.escape(username);
    if (validator.isAlphanumeric(socket.username) === false) {
      console.log('username is invalid');
      socket.emit('alertbadname');
    } else {
      db.serialize(function() {
        console.log('checking if user exists');
        var checkIfUserExists = "select count(*) from users where username = '" + socket.username +"'";
        db.get(checkIfUserExists, function(err, row) {
          if (err) {
            console.error('error looking up if user exists', err);
            return;
          }
          if (row['count(*)'] !== 0) {
            console.log('user exists!');
            socket.emit('alertuserexists');
          } else {
            socket.emit('redirect');
            console.log('adding user to database');
            var insertUserStr = "INSERT INTO users (username, lastlogon) VALUES ('" + socket.username + "'," + Date.now() + ");"
            console.log(insertUserStr);
            db.run(insertUserStr);
            // add the client's username to the global list
            usernames[username] = username;
            ++numUsers;
            addedUser = true;
            socket.emit('login', {
              numUsers: numUsers
            });
            // echo globally (all clients) that a person has connected
            socket.broadcast.emit('user joined', {
              username: socket.username,
              numUsers: numUsers
            });
            console.log('loading previous chats for user');
            var queryChatsStr = "SELECT username, content FROM messages WHERE posted < " + Date.now() + " LIMIT 100";
            console.log(queryChatsStr);
            db.all(queryChatsStr, function(err, all) {
              if (err) {
                console.error('error looking up previous chats', err);
                return;
              } else {
                all.forEach(function(chat) {
                  chat.content = validator.unescape(chat.content);
                 });
                socket.emit('loadchat', all);
              }
            });
          }
        });
      });
    }
  });

  socket.on('existing user', function (username) {
    // we store the username in the socket session for this client
    socket.username = validator.escape(username);
    db.serialize(function() {
      console.log('checking if user exists');
      var checkIfUserExists = "select count(*) from users where username = '" + socket.username +"'";
      db.get(checkIfUserExists, function(err, row) {
        if (err) {
          console.error('error looking up if user exists', err);
          return;
        }
        if (row['count(*)'] === 0) {
          console.log("user doesn't exist!");
          socket.emit('alertuserdoesntexists');
        } else {
          socket.emit('redirect');
          // add the client's username to the global list
          usernames[username] = username;
          numUsers = 0;
          for (var i in usernames) {
            numUsers += 1;
          }
          addedUser = true;
          socket.emit('login', {
            numUsers: numUsers
          });
          // echo globally (all clients) that a person has connected
          socket.broadcast.emit('user joined', {
            username: socket.username,
            numUsers: numUsers
          });
          console.log('loading previous chats for user');
          var lastLogoffStr = "SELECT lastlogoff FROM users WHERE username = '" + socket.username + "';";
          console.log(lastLogoffStr);
          var lastLogoff;
          var queryChatsStr;
          db.get(lastLogoffStr, function(err, row) {
            if (err) {
              console.error('error looking up last logoff', err);
              return;
            } else {
              lastLogoff = row.lastlogoff;
              if (lastLogoff === undefined) {
                queryChatsStr = "SELECT username, content FROM messages WHERE posted < " + Date.now() + " LIMIT 100";
              } else {
                queryChatsStr = "SELECT username, content FROM messages WHERE posted > " + lastLogoff + " LIMIT 100";
              }
            }
            console.log('lastLogoff', lastLogoff);
            console.log(queryChatsStr);
            db.all(queryChatsStr, function(err, all) {
              if (err) {
                console.error('error looking up previous chats', err);
                return;
              } else {
                all.forEach(function(chat) {
                  chat.content = validator.unescape(chat.content);
                });
                socket.emit('loadchat', all);
              }
            });
          });
        }
      });
    });
  });

  // when the client emits 'typing', we broadcast it to others
  socket.on('typing', function () {
    socket.broadcast.emit('typing', {
      username: socket.username
    });
  });

  // when the client emits 'stop typing', we broadcast it to others
  socket.on('stop typing', function () {
    socket.broadcast.emit('stop typing', {
      username: socket.username
    });
  });

  // when the user disconnects.. perform this
  socket.on('disconnect', function () {
    // remove the username from global usernames list
    if (addedUser) {
      delete usernames[socket.username];
      --numUsers;

      // echo globally that this client has left
      socket.broadcast.emit('user left', {
        username: socket.username,
        numUsers: numUsers
      });
    }
    db.serialize(function() {
      console.log('updating user logoff time');
      var updateLogoffStr = "UPDATE users SET lastlogoff = " + Date.now() + " WHERE username = '" + socket.username + "';";
      console.log(updateLogoffStr)
      db.run(updateLogoffStr);
    });
  });
});

db.serialize(function() {
  console.log('creating databases if they don\'t exist');
  db.run('create table if not exists users (userid integer primary key, username text not null, lastlogon integer, lastlogoff integer)');
  db.run('create table if not exists messages (messageid integer primary key, username text not null, content text, posted integer)');
});
