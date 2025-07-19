// Discord Proxy Server - Real-time Version
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for easier setup
        methods: ["GET", "POST"],
        credentials: true
    }
});

const port = process.env.PORT || 3000;

// Discord config
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || 'MTM5NTk4NjA4NDQzNjkwNjAxNQ.G-I_KQ.8wU0S1RnbAI50YKg36MKW1NuBgXLxUwvIUtneM';
const DISCORD_CHANNEL_ID = '1395980660908359820';

// Store messages in memory (in production, use a database)
let messageHistory = [];
let connectedUsers = new Set();

// Middleware
app.use(cors({
    origin: "*", // Allow all origins for easier setup
    credentials: true
}));
app.use(express.json());
app.use(express.static('.'));

// Root route
app.get('/', (req, res) => {
    res.json({
        status: 'Discord Proxy Server Online',
        timestamp: new Date().toISOString(),
        endpoints: ['/health', '/api/discord-messages', '/test-chat.html']
    });
});

// Test chat page
app.get('/chat', (req, res) => {
    res.sendFile(__dirname + '/test-chat.html');
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        botToken: DISCORD_BOT_TOKEN ? 'Configured' : 'Missing'
    });
});

// Get Discord messages
app.get('/api/discord-messages', async (req, res) => {
    try {
        if (!DISCORD_BOT_TOKEN) {
            return res.status(500).json({
                success: false,
                error: 'Bot token not configured'
            });
        }

        const limit = req.query.limit || 20;
        const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages?limit=${limit}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(500).json({
                success: false,
                error: `Discord API error: ${response.status}`,
                details: errorText
            });
        }

        const messages = await response.json();

        // Format messages
        const formattedMessages = messages
            .filter(msg => !msg.author.bot && msg.content.trim())
            .map(msg => ({
                id: msg.id,
                content: msg.content,
                author: msg.author.username || msg.author.global_name || 'Unknown',
                timestamp: msg.timestamp,
                type: 'discord'
            }));

        res.json({
            success: true,
            messages: formattedMessages,
            count: formattedMessages.length
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// WebSocket connection handling
io.on('connection', (socket) => {
    console.log(`👤 User connected: ${socket.id}`);
    connectedUsers.add(socket.id);
    
    // Send message history to newly connected user
    socket.emit('message_history', messageHistory);
    
    // Broadcast user count
    io.emit('user_count', connectedUsers.size);
    
    // Handle user sending message
    socket.on('send_message', async (data) => {
        const message = {
            id: Date.now(),
            content: data.content,
            author: data.author || 'Anonymous',
            timestamp: new Date().toISOString(),
            type: 'website',
            socketId: socket.id
        };
        
        // Add to message history
        messageHistory.push(message);
        
        // Keep only last 100 messages in memory
        if (messageHistory.length > 100) {
            messageHistory = messageHistory.slice(-100);
        }
        
        // Broadcast to all connected clients
        io.emit('new_message', message);
        
        // Send to Discord
        await sendToDiscord(message.content, message.author);
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`👤 User disconnected: ${socket.id}`);
        connectedUsers.delete(socket.id);
        io.emit('user_count', connectedUsers.size);
    });
});

// Function to send message to Discord
async function sendToDiscord(content, author) {
    try {
        const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: `**${author}** (from website): ${content}`
            })
        });
        
        if (!response.ok) {
            console.error('Failed to send message to Discord:', response.status);
        }
    } catch (error) {
        console.error('Error sending to Discord:', error);
    }
}

// Function to fetch and broadcast Discord messages
async function fetchDiscordMessages() {
    try {
        if (!DISCORD_BOT_TOKEN) return;
        
        const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages?limit=10`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const messages = await response.json();
            
            // Process new Discord messages
            const newDiscordMessages = messages
                .filter(msg => !msg.author.bot && msg.content.trim())
                .filter(msg => {
                    // Only include messages that aren't already in our history
                    return !messageHistory.some(histMsg => 
                        histMsg.type === 'discord' && histMsg.discordId === msg.id
                    );
                })
                .map(msg => ({
                    id: Date.now() + Math.random(),
                    discordId: msg.id,
                    content: msg.content,
                    author: msg.author.username || msg.author.global_name || 'Discord User',
                    timestamp: msg.timestamp,
                    type: 'discord'
                }));
            
            // Add new messages to history and broadcast
            newDiscordMessages.forEach(message => {
                messageHistory.push(message);
                io.emit('new_message', message);
            });
            
            // Keep only last 100 messages
            if (messageHistory.length > 100) {
                messageHistory = messageHistory.slice(-100);
            }
        }
    } catch (error) {
        console.error('Error fetching Discord messages:', error);
    }
}

// Poll Discord for new messages every 5 seconds
setInterval(fetchDiscordMessages, 5000);

server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`🔑 Bot token: ${DISCORD_BOT_TOKEN ? 'YES' : 'NO'}`);
    console.log(`💬 WebSocket enabled for real-time chat`);
    
    // Fetch initial Discord messages
    fetchDiscordMessages();
});
