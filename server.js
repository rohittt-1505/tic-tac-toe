// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Socket.io setup with CORS
const io = new Server(server, {
  cors: {
    origin: "*", // In production, replace with your specific domain
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Game rooms storage
const rooms = {};

// Check for win conditions
function checkWinner(gameState) {
  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
    [0, 4, 8], [2, 4, 6]             // Diagonals
  ];

  for (let pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (gameState[a] && gameState[a] === gameState[b] && gameState[a] === gameState[c]) {
      return gameState[a];
    }
  }

  // Check for draw
  if (!gameState.includes('')) {
    return 'draw';
  }

  return null;
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Create a new game room
  socket.on('createRoom', (data) => {
    const room = data.room;
    const name = data.name;

    // Store room information
    rooms[room] = {
      host: {
        id: socket.id,
        name: name,
        symbol: 'X'
      },
      guest: null,
      gameState: ['', '', '', '', '', '', '', '', ''],
      currentTurn: 'X',
      status: 'waiting'
    };

    // Join the room
    socket.join(room);

    // Send confirmation to the client
    io.to(socket.id).emit('roomCreated', { room });
    console.log(`Room created: ${room} by ${name}`);
  });

  // Join an existing room
  socket.on('joinRoom', (data) => {
    const room = data.room;
    const name = data.name;

    // Check if room exists
    if (!rooms[room]) {
      io.to(socket.id).emit('joinError', { message: 'Room does not exist' });
      return;
    }

    // Check if room is full
    if (rooms[room].guest) {
      io.to(socket.id).emit('joinError', { message: 'Room is full' });
      return;
    }

    // Join the room
    socket.join(room);

    // Update room information
    rooms[room].guest = {
      id: socket.id,
      name: name,
      symbol: 'O'
    };
    
    rooms[room].status = 'playing';

    // Notify the guest about successful join
    io.to(socket.id).emit('joinSuccess', { 
      room,
      symbol: 'O',
      hostName: rooms[room].host.name
    });

    // Notify the host about the game start
    io.to(rooms[room].host.id).emit('gameStart', {
      symbol: 'X',
      opponentName: name
    });

    console.log(`${name} joined room: ${room}`);
  });

  // Handle player moves
  socket.on('makeMove', (data) => {
    const room = data.room;
    const index = data.index;

    if (!rooms[room]) return;

    const gameState = rooms[room].gameState;
    const isHost = socket.id === rooms[room].host.id;
    const symbol = isHost ? 'X' : 'O';

    // Ensure it's the player's turn
    if (rooms[room].currentTurn !== symbol) return;

    // Make the move
    gameState[index] = symbol;

    // Switch turns
    rooms[room].currentTurn = symbol === 'X' ? 'O' : 'X';

    // Check for winner
    const winner = checkWinner(gameState);

    if (winner) {
      // Game over
      if (winner === 'draw') {
        io.to(room).emit('gameOver', { winner: null });
      } else {
        io.to(room).emit('gameOver', { winner });
      }
      
      // Reset game state but keep score
      rooms[room].gameState = ['', '', '', '', '', '', '', '', ''];
      rooms[room].currentTurn = 'X';
    } else {
      // Update game state for all players
      io.to(room).emit('gameUpdate', {
        gameState,
        nextPlayer: rooms[room].currentTurn
      });
    }
  });

  // Handle new game request
  socket.on('requestNewGame', (data) => {
    const room = data.room;

    if (!rooms[room]) return;

    // Reset game state
    rooms[room].gameState = ['', '', '', '', '', '', '', '', ''];
    rooms[room].currentTurn = 'X';

    // Notify all players
    io.to(room).emit('newGame');
  });

  // Handle player leaving
  socket.on('leaveRoom', (data) => {
    const room = data.room;

    if (!rooms[room]) return;

    // Notify other player
    socket.to(room).emit('opponentLeft');

    // Leave the room
    socket.leave(room);

    // Check if the player is host or guest
    if (rooms[room].host && rooms[room].host.id === socket.id) {
      console.log(`Host left room: ${room}`);
      delete rooms[room];
    } else if (rooms[room].guest && rooms[room].guest.id === socket.id) {
      console.log(`Guest left room: ${room}`);
      rooms[room].guest = null;
      rooms[room].status = 'waiting';
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Find and clean up any rooms the user was part of
    for (const room in rooms) {
      const roomData = rooms[room];
      
      if (roomData.host && roomData.host.id === socket.id) {
        // Host disconnected, notify guest and delete room
        socket.to(room).emit('opponentLeft');
        delete rooms[room];
        console.log(`Host disconnected, room deleted: ${room}`);
      } else if (roomData.guest && roomData.guest.id === socket.id) {
        // Guest disconnected, notify host and reset room status
        socket.to(room).emit('opponentLeft');
        roomData.guest = null;
        roomData.status = 'waiting';
        console.log(`Guest disconnected from room: ${room}`);
      }
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});