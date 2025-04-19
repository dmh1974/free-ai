const API_URL = 'https://text.pollinations.ai/models';

// Global models array to store fetched models
let models = [];

// Configuration for different sources
const SOURCES = {
    pollinations: {
        name: 'Pollinations',
        textUrl: 'https://text.pollinations.ai/models?private=true',
        imageUrl: 'https://image.pollinations.ai/models?private=true',
        color: '#10b981'
    }
    // Add more sources here in the future
};

// List of models to exclude from display
const EXCLUDED_MODELS = [
    'evil',
    'unity',
    'llamalight',
    'hypnosis-tracy',
    'roblox-rp',
    'sur',
    'llama-scaleway',
    'openai-reasoning'
];

// Rate limiting configuration
const RATE_LIMIT = {
    cooldown: 5000, // 5 seconds in milliseconds
    lastRequestTime: 0,
    requestQueue: [],
    isProcessing: false
};

// Add this at the top with other global variables
let activeRequestController = null;

// Multi-Chat functionality
let selectedModels = new Set();
let multiChatMessages = [];

// Add these constants at the top with other constants
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const CACHE_KEY = 'model_lists_cache';

// Add download functionality at the global scope
window.downloadImage = function(url) {
    const a = document.createElement('a');
    a.href = url;
    const timestamp = Date.now();
    a.download = `generated-image-${timestamp}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

function initializeMultiChat() {
    const multiChatButton = document.getElementById('multi-chat-button');
    const multiChatInterface = document.querySelector('.multi-chat-interface');
    const multiChatClose = document.querySelector('.multi-chat-close');
    const multiChatInput = document.querySelector('.multi-chat-input');
    const multiChatSend = document.querySelector('.multi-chat-send');
    const multiChatMessagesContainer = document.getElementById('multi-chat-messages');
    const multiChatImagePreviewContainer = document.querySelector('.multi-chat-input-container .image-preview-container');
    const modelCheckboxes = document.getElementById('model-checkboxes');
    const clearChatButton = document.querySelector('.multi-chat-interface .clear-chat-button');

    // Load saved selected models
    const savedSelectedModels = JSON.parse(localStorage.getItem('multiChatSelectedModels') || '[]');
    selectedModels = new Set(savedSelectedModels.filter(modelId => {
        const model = models.find(m => m.id === modelId || m.name === modelId);
        return model && !EXCLUDED_MODELS.includes(model.name || model.id);
    }));

    // Update checkboxes based on saved selection
    const checkboxes = modelCheckboxes.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        const modelId = checkbox.value;
        const model = models.find(m => m.id === modelId || m.name === modelId);
        if (model && !EXCLUDED_MODELS.includes(model.name || model.id)) {
            checkbox.checked = selectedModels.has(modelId);
        } else {
            checkbox.checked = false;
            checkbox.disabled = true;
        }
    });

    // Save selected models when changed
    modelCheckboxes.addEventListener('change', (event) => {
        if (event.target.type === 'checkbox') {
            if (event.target.checked) {
                selectedModels.add(event.target.value);
            } else {
                selectedModels.delete(event.target.value);
            }
            localStorage.setItem('multiChatSelectedModels', JSON.stringify(Array.from(selectedModels)));
        }
    });

    let multiChatAttachedImages = [];

    // Add helper function for image conversion
    async function convertImageToBinary(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result); // This will be a data URL
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Initialize model checkboxes
    function updateModelCheckboxes() {
        modelCheckboxes.innerHTML = '';
        if (!models || models.length === 0) {
            modelCheckboxes.innerHTML = '<div class="error-message">No models available. Please try again later.</div>';
            return;
        }

        // Add select all/deselect all buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'model-select-buttons';
        buttonContainer.innerHTML = `
            <button class="select-all-button">Select All</button>
            <button class="deselect-all-button">Deselect All</button>
        `;
        modelCheckboxes.appendChild(buttonContainer);

        // Create checkboxes for all models, excluding those in EXCLUDED_MODELS
        models.forEach(model => {
            if (!model || !model.id) return; // Skip invalid models
            if (EXCLUDED_MODELS.includes(model.name || model.id)) return; // Skip excluded models
            
            const checkbox = document.createElement('div');
            checkbox.className = 'model-checkbox';
            checkbox.innerHTML = `
                <input type="checkbox" id="model-${model.id}" ${selectedModels.has(model.id) ? 'checked' : ''}>
                <label for="model-${model.id}">${model.name || model.id}</label>
            `;
            const checkboxInput = checkbox.querySelector('input');
            checkboxInput.addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedModels.add(model.id);
                } else {
                    selectedModels.delete(model.id);
                }
            });
            modelCheckboxes.appendChild(checkbox);
        });

        // Add event listeners for select all/deselect all buttons
        const selectAllButton = buttonContainer.querySelector('.select-all-button');
        const deselectAllButton = buttonContainer.querySelector('.deselect-all-button');

        selectAllButton.addEventListener('click', () => {
            selectedModels.clear();
            models.forEach(model => {
                if (model && model.id && !EXCLUDED_MODELS.includes(model.name || model.id)) {
                    selectedModels.add(model.id);
                    const checkbox = document.querySelector(`#model-${model.id}`);
                    if (checkbox) checkbox.checked = true;
                }
            });
        });

        deselectAllButton.addEventListener('click', () => {
            selectedModels.clear();
            const checkboxes = document.querySelectorAll('.model-checkbox input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
            });
        });
    }

    // Add message to multi-chat
    function addMultiChatMessage(content, modelId = null, isError = false, isImage = false, status = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `multi-chat-message ${isError ? 'error' : ''}`;
        
        if (modelId) {
            const model = models.find(m => m.id === modelId);
            messageDiv.innerHTML = `
                <div class="multi-chat-message-header">
                    <span>${model ? model.name || model.id : 'Unknown Model'}</span>
                    <span>${new Date().toLocaleTimeString()}</span>
                </div>
                <div class="multi-chat-message-content">
                    ${status ? `<div class="message-status">${status}</div>` : ''}
                    ${isImage ? `
                        <div class="image-preview generated-image">
                            <img src="${content}" alt="Generated image">
                            <button class="download-button" onclick="downloadImage('${content}')">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                Download
                            </button>
                        </div>
                    ` : content}
                </div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="multi-chat-message-header">
                    <span>You</span>
                    <span>${new Date().toLocaleTimeString()}</span>
                </div>
                <div class="multi-chat-message-content">
                    ${content}
                    ${multiChatAttachedImages.length > 0 ? `
                        <div class="message-images">
                            ${multiChatAttachedImages.map(img => `
                                <div class="image-preview">
                                    <img src="${img}" alt="Attached image">
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }
        
        multiChatMessagesContainer.appendChild(messageDiv);
        multiChatMessagesContainer.scrollTop = multiChatMessagesContainer.scrollHeight;
        return messageDiv;
    }

    // Update message status
    function updateMessageStatus(messageDiv, status) {
        const statusDiv = messageDiv.querySelector('.message-status');
        if (statusDiv) {
            statusDiv.textContent = status;
        }
    }

    // Handle image attachment in multi-chat
    async function handleMultiChatImageAttach(event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        
        // Limit to 20 images
        const filesToProcess = Array.from(files).slice(0, 20 - multiChatAttachedImages.length);
        
        for (const file of filesToProcess) {
            if (!file.type.startsWith('image/')) continue;
            
            try {
                const binaryData = await convertImageToBinary(file);
                multiChatAttachedImages.push(binaryData);
                
                // Create preview
                const preview = document.createElement('div');
                preview.className = 'image-preview';
                
                const img = document.createElement('img');
                img.src = URL.createObjectURL(file);
                preview.appendChild(img);
                
                const removeButton = document.createElement('button');
                removeButton.className = 'remove-image';
                removeButton.innerHTML = '×';
                removeButton.onclick = () => {
                    const index = multiChatAttachedImages.indexOf(binaryData);
                    if (index > -1) {
                        multiChatAttachedImages.splice(index, 1);
                        preview.remove();
                    }
                };
                preview.appendChild(removeButton);
                
                multiChatImagePreviewContainer.appendChild(preview);
            } catch (error) {
                console.error('Error processing image:', error);
            }
        }
        
        // Focus the chat input after attaching images
        multiChatInput.focus();
    }

    // Handle multi-chat message sending
    async function sendMultiChatMessage() {
        const message = multiChatInput.value.trim();
        if (!message && multiChatAttachedImages.length === 0) return;
        if (selectedModels.size === 0) return; // Don't send if no models are selected

        // Add user message
        addMultiChatMessage(message);
        multiChatInput.value = '';
        multiChatSend.disabled = true;

        // Create message boxes for all selected models immediately
        const modelMessages = new Map();
        const queuedModels = new Set(selectedModels); // Create a fresh copy of selected models

        // Check image support for each model
        for (const modelId of queuedModels) {
            const model = models.find(m => m.id === modelId);
            if (!model) continue;

            const modelCard = document.querySelector(`[data-model-id="${modelId}"]`);
            if (!modelCard) {
                console.error(`Model card not found for ${modelId}`);
                continue; // Skip this model instead of throwing an error
            }

            // Check if model supports image input
            const capabilities = modelCard.querySelectorAll('.capability span:last-child');
            const supportsImageInput = Array.from(capabilities).some(cap => cap.textContent === 'Image Input');

            // If there are attached images but model doesn't support them, show error message
            if (multiChatAttachedImages.length > 0 && !supportsImageInput) {
                const statusMessage = addMultiChatMessage('', modelId, false, false, 'Message Queued');
                modelMessages.set(modelId, statusMessage);
                updateMessageStatus(statusMessage, 'Images not supported for this model. Request cancelled.');
                queuedModels.delete(modelId);
                continue;
            }

            const statusMessage = addMultiChatMessage('', modelId, false, false, 'Message Queued');
            modelMessages.set(modelId, statusMessage);
        }

        // Process messages sequentially using the rate limiting system
        for (const modelId of queuedModels) {
            try {
                // Get the model card to access its settings and chat container
                const modelCard = document.querySelector(`[data-model-id="${modelId}"]`);
                if (!modelCard) {
                    console.error(`Model card not found for ${modelId}`);
                    continue; // Skip this model instead of throwing an error
                }

                const statusMessage = modelMessages.get(modelId);
                if (!statusMessage) continue;

                // Check if this is an image or audio model
                const isImageModel = modelCard.querySelector('.model-type.image') !== null;
                const isAudioModel = modelCard.querySelector('.model-type.audio') !== null;

                // Wait for the rate limiting system to be ready
                while (RATE_LIMIT.isProcessing) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                if (isImageModel) {
                    // For image models, use the rate limiting system
                    updateMessageStatus(statusMessage, 'Message Sent');
                    try {
                        await new Promise((resolve, reject) => {
                            RATE_LIMIT.requestQueue.push({
                                type: 'image',
                                prompt: message,
                                modelId,
                                modelCard,
                                resolve,
                                reject
                            });
                            processRequestQueue();
                        });

                        // Get the response from the chat container
                        const chatContainer = modelCard.querySelector('.chat-messages');
                        const lastMessage = chatContainer?.lastElementChild;
                        if (lastMessage && lastMessage.classList.contains('assistant')) {
                            const imagePreview = lastMessage.querySelector('.image-preview.generated-image img');
                            if (imagePreview) {
                                const imageUrl = imagePreview.src;
                                statusMessage.querySelector('.multi-chat-message-content').innerHTML = `
                                    <div class="image-preview generated-image">
                                        <img src="${imageUrl}" alt="Generated image">
                                        <button class="download-button" onclick="downloadImage('${imageUrl}')">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                                <polyline points="7 10 12 15 17 10"></polyline>
                                                <line x1="12" y1="15" x2="12" y2="3"></line>
                                            </svg>
                                            Download
                                        </button>
                                    </div>
                                `;
                            } else {
                                throw new Error('Failed to get image response');
                            }
                        } else {
                            throw new Error('Failed to get image response');
                        }
                    } catch (error) {
                        console.error('Error in image generation:', error);
                        updateMessageStatus(statusMessage, 'Error: Failed to generate image');
                    }
                } else if (isAudioModel) {
                    // For audio models, use direct endpoint
                    updateMessageStatus(statusMessage, 'Message Sent');
                    try {
                        const voiceSelector = modelCard.querySelector('.voice-selector');
                        const voice = voiceSelector ? voiceSelector.value : 'alloy';
                        
                        // Get system prompt
                        const systemPrompt = modelCard.querySelector('#system-prompt')?.value || "You are a helpful assistant.";
                        
                        // Format the message with system prompt
                        const formattedMessage = `${systemPrompt}\n\n${message}`;
                        
                        const response = await fetch(`https://text.pollinations.ai/${encodeURIComponent(formattedMessage)}?model=openai-audio&voice=${voice}&private=true`, {
                            method: 'GET',
                            headers: {
                                'Accept': 'audio/mpeg'
                            }
                        });

                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }

                        if (response.headers.get('Content-Type')?.includes('audio/mpeg')) {
                            const audioBlob = await response.blob();
                            const audioUrl = URL.createObjectURL(audioBlob);
                            
                            statusMessage.querySelector('.multi-chat-message-content').innerHTML = `
                                <div class="audio-player">
                                    <audio controls autoplay>
                                        <source src="${audioUrl}" type="audio/mpeg">
                                        Your browser does not support the audio element.
                                    </audio>
                                </div>
                            `;
                        } else {
                            throw new Error('API did not return audio content');
                        }
                    } catch (error) {
                        console.error('Error in audio generation:', error);
                        updateMessageStatus(statusMessage, 'Error: Failed to generate audio');
                    }
                } else if (modelId === 'searchgpt') {
                    // For searchgpt, use direct endpoint
                    updateMessageStatus(statusMessage, 'Message Sent');
                    try {
                        const searchUrl = `https://text.pollinations.ai/${encodeURIComponent(message)}?model=searchgpt&private=true`;
                        const response = await fetch(searchUrl);
                        
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        
                        const text = await response.text();
                        const parsedHtml = marked.parse(text);
                        statusMessage.querySelector('.multi-chat-message-content').innerHTML = parsedHtml;
                    } catch (error) {
                        console.error('Error in searchgpt:', error);
                        updateMessageStatus(statusMessage, 'Error: Failed to get response');
                    }
                } else {
                    // For text models, use streaming
                    updateMessageStatus(statusMessage, 'Message Sent');
                    try {
                        // Use streaming for other text models
                        const contentDiv = statusMessage.querySelector('.multi-chat-message-content');
                        let currentMessage = '';
                        
                        // Get model parameters
                        const systemPrompt = modelCard.querySelector('#system-prompt')?.value || "You are a helpful assistant.";
                        const temperature = parseFloat(modelCard.querySelector('#temperature')?.value || 0.9);
                        const topP = parseFloat(modelCard.querySelector('#top-p')?.value || 0.7);
                        const maxTokens = parseInt(modelCard.querySelector('#max-tokens')?.value || 500);
                        const seed = parseInt(modelCard.querySelector('#seed')?.value || 42);

                        // Format messages for the API request
                        const formattedMessages = [
                            { role: "system", content: systemPrompt },
                            ...multiChatMessages,
                            { 
                                role: 'user', 
                                content: message,
                                images: multiChatAttachedImages
                            }
                        ];

                        // Make streaming request
                        const response = await fetch('https://text.pollinations.ai/openai?private=true', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                model: modelId,
                                messages: formattedMessages,
                                temperature,
                                top_p: topP,
                                max_tokens: maxTokens,
                                seed,
                                stream: true
                            })
                        });

                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }

                        const reader = response.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = '';

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop();

                            for (const line of lines) {
                                if (line.startsWith('data: ')) {
                                    const dataStr = line.slice(6).trim();
                                    if (dataStr === '[DONE]') {
                                        continue;
                                    }
                                    
                                    try {
                                        const data = JSON.parse(dataStr);
                                        if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
                                            currentMessage += data.choices[0].delta.content;
                                            contentDiv.innerHTML = marked.parse(currentMessage);
                                            multiChatMessagesContainer.scrollTop = multiChatMessagesContainer.scrollHeight;
                                        }
                                    } catch (e) {
                                        console.error('Error parsing stream data:', e);
                                        continue;
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error in text generation:', error);
                        updateMessageStatus(statusMessage, 'Error: Failed to get response');
                    }
                }

                // Ensure we wait for the cooldown period before processing the next model
                const now = Date.now();
                const timeSinceLastRequest = now - RATE_LIMIT.lastRequestTime;
                if (timeSinceLastRequest < RATE_LIMIT.cooldown) {
                    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.cooldown - timeSinceLastRequest));
                }
            } catch (error) {
                console.error('Error in multi-chat:', error);
                const statusMessage = modelMessages.get(modelId);
                if (statusMessage) {
                    updateMessageStatus(statusMessage, `Error: ${error.message}`);
                }
            }
        }

        // Clear attached images after sending
        multiChatAttachedImages = [];
        multiChatImagePreviewContainer.innerHTML = '';
        multiChatSend.disabled = false;
        multiChatMessages.push({ 
            role: 'user', 
            content: message,
            images: multiChatAttachedImages 
        });
    }

    // Event listeners
    multiChatButton.addEventListener('click', () => {
        multiChatInterface.classList.add('active');
        updateModelCheckboxes();
    });

    multiChatClose.addEventListener('click', () => {
        multiChatInterface.classList.remove('active');
    });

    multiChatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Stop newline
            sendMultiChatMessage();
        }
        // Shift+Enter will just work as normal (new line)
    });

    multiChatSend.addEventListener('click', sendMultiChatMessage);

    // Add image attachment functionality
    if (multiChatImagePreviewContainer) {
        multiChatImagePreviewContainer.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.multiple = true;
            input.onchange = handleMultiChatImageAttach;
            input.click();
        });
    }

    // Clear chat functionality
    clearChatButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all chat history? This will clear all messages and conversation history.')) {
            // Clear the messages container
            multiChatMessagesContainer.innerHTML = '';
            
            // Clear the multi-chat messages array
            multiChatMessages = [];
            
            // Clear all individual model chat histories
            const modelCards = document.querySelectorAll('.model-card');
            modelCards.forEach(card => {
                const chatMessages = card.querySelector('.chat-messages');
                if (chatMessages) {
                    chatMessages.innerHTML = '';
                }
            });
        }
    });

    // Add event listener for export button
    document.querySelector('.export-chat-button').addEventListener('click', exportMultiChat);

    function exportMultiChat() {
        const messages = document.querySelectorAll('.multi-chat-message');
        let exportContent = '';
        
        messages.forEach(message => {
            const header = message.querySelector('.multi-chat-message-header');
            const content = message.querySelector('.multi-chat-message-content');
            
            if (header && content && 
                !header.textContent.includes('You') && 
                !content.textContent.includes('Error: Failed to get response')) {
                // Remove timestamp using regex
                const modelName = header.textContent.replace(/\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M\s*$/, '').trim();
                
                // Get text content and remove any HTML markup
                const textContent = content.textContent.trim();
                
                if (textContent) {
                    exportContent += `${modelName}\n${textContent}\n\n`;
                }
            }
        });
        
        if (exportContent) {
            // Create and download the file
            const blob = new Blob([exportContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'multi-chat-export.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else {
            alert('No messages to export');
        }
    }
}

async function processRequestQueue() {
    if (RATE_LIMIT.isProcessing || RATE_LIMIT.requestQueue.length === 0) {
        return;
    }

    RATE_LIMIT.isProcessing = true;
    const now = Date.now();
    const timeSinceLastRequest = now - RATE_LIMIT.lastRequestTime;

    if (timeSinceLastRequest < RATE_LIMIT.cooldown) {
        // Wait for the remaining cooldown time
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.cooldown - timeSinceLastRequest));
    }

    const request = RATE_LIMIT.requestQueue.shift();
    
    try {
        if (request.type === 'image') {
            // Handle image generation request
            const params = new URLSearchParams({
                nologo: 'true',
                private: 'true'
            });

            // Get custom parameters for image models
            const width = request.modelCard.querySelector('#width')?.value || '1024';
            const height = request.modelCard.querySelector('#height')?.value || '1024';
            const seed = request.modelCard.querySelector('#seed')?.value || '42';
            
            params.append('width', width);
            params.append('height', height);
            params.append('seed', seed);
            
            const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(request.prompt)}?${params.toString()}`;
            
            const startTime = Date.now();
            const controller = new AbortController();
            activeRequestController = controller;

            const response = await fetch(url, {
                signal: controller.signal
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            
            const imageBlob = await response.blob();
            const endTime = Date.now();
            const responseTime = ((endTime - startTime) / 1000).toFixed(2);
            
            const imageUrl = URL.createObjectURL(imageBlob);
            
            // Add the image to the model's chat container
            const chatContainer = request.modelCard.querySelector('.chat-messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message assistant';
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="image-preview generated-image">
                        <img src="${imageUrl}" alt="Generated image">
                    </div>
                </div>
            `;
            chatContainer.appendChild(messageDiv);
            
            request.resolve();
        } else {
            // Handle text chat completion request
            await streamChatCompletion(request.messages, request.modelId);
            request.resolve();
        }
        
        RATE_LIMIT.lastRequestTime = Date.now();
    } catch (error) {
        request.reject(error);
    }

    RATE_LIMIT.isProcessing = false;
    processRequestQueue();
}

async function rateLimitedChatCompletion(messages, modelId) {
    return new Promise((resolve, reject) => {
        RATE_LIMIT.requestQueue.push({ messages, modelId, resolve, reject });
        processRequestQueue();
    });
}

async function fetchModels(source = 'pollinations') {
    try {
        // Check cache first
        const cachedData = localStorage.getItem(CACHE_KEY);
        if (cachedData) {
            const { timestamp, data } = JSON.parse(cachedData);
            const now = Date.now();
            
            // If cache is less than 24 hours old, use it
            if (now - timestamp < CACHE_EXPIRY) {
                const { textModels, imageModels } = data;
                // Store all models in the global models array with proper IDs
                models = [
                    ...textModels.map(model => ({
                        ...model,
                        id: model.name || model.id || 'text-model'
                    })),
                    ...imageModels.map(model => ({
                        ...model,
                        id: typeof model === 'string' ? model : (model.name || model.id || 'image-model')
                    }))
                ];
                displayModels(textModels, imageModels, source);
                return;
            }
        }

        // Show loading message
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) {
            loadingMessage.style.display = 'block';
        }

        // Fetch text models
        const textResponse = await fetch(SOURCES[source].textUrl);
        if (!textResponse.ok) {
            throw new Error('Failed to fetch text models');
        }
        const textModels = await textResponse.json();
        
        // Fetch image models
        const imageResponse = await fetch(SOURCES[source].imageUrl);
        if (!imageResponse.ok) {
            throw new Error('Failed to fetch image models');
        }
        const imageModels = await imageResponse.json();
        
        // Store all models in the global models array with proper IDs
        models = [
            ...textModels.map(model => ({
                ...model,
                id: model.name || model.id || 'text-model'
            })),
            ...imageModels.map(model => ({
                ...model,
                id: typeof model === 'string' ? model : (model.name || model.id || 'image-model')
            }))
        ];
        
        // Cache the fetched data
        const cacheData = {
            timestamp: Date.now(),
            data: {
                textModels,
                imageModels
            }
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
        
        displayModels(textModels, imageModels, source);
    } catch (error) {
        console.error('Error fetching models:', error);
        
        // If there's an error, try to use cached data even if it's expired
        const cachedData = localStorage.getItem(CACHE_KEY);
        if (cachedData) {
            const { data } = JSON.parse(cachedData);
            const { textModels, imageModels } = data;
            // Store all models in the global models array with proper IDs
            models = [
                ...textModels.map(model => ({
                    ...model,
                    id: model.name || model.id || 'text-model'
                })),
                ...imageModels.map(model => ({
                    ...model,
                    id: typeof model === 'string' ? model : (model.name || model.id || 'image-model')
                }))
            ];
            displayModels(textModels, imageModels, source);
            return;
        }
        
        document.getElementById('models-container').innerHTML = `
            <div class="error-message">
                Failed to load models. Please try again later.
            </div>
        `;
    }
}

function displayModels(textModels, imageModels, source) {
    const modelsContainer = document.getElementById('models-container');
    const loadingMessage = document.getElementById('loading-message');
    const modelCount = document.getElementById('model-count');

    // Clear loading message
    if (loadingMessage) {
        loadingMessage.remove();
    }
    
    // Filter out excluded models
    const filteredTextModels = textModels.filter(model => !EXCLUDED_MODELS.includes(model.name));
    const filteredImageModels = imageModels.filter(model => !EXCLUDED_MODELS.includes(model.name));

    // Update model count with filtered models
    const totalModels = filteredTextModels.length + filteredImageModels.length;
    modelCount.textContent = totalModels;
    
    // Create cards for text models
    const textModelCards = filteredTextModels.map(model => createModelCard(model, source, 'text'));
    
    // Create cards for image models
    const imageModelCards = filteredImageModels.map(model => createModelCard(model, source, 'image'));
    
    // Combine and display all cards
    modelsContainer.innerHTML = [...textModelCards, ...imageModelCards].join('');
    
    // Initialize chat functionality for all models
    const allModels = [...filteredTextModels, ...filteredImageModels];
    allModels.forEach(model => {
        const modelId = typeof model === 'string' ? model : model.name;
        const card = document.querySelector(`[data-model-id="${modelId}"]`);
        if (card) {
            initializeChat(card, modelId);
        }
    });
}

function createModelCard(model, source, type) {
    const isImageModel = type === 'image';
    const isAudioModel = model.name === 'openai-audio';
    
    // Get saved parameters from localStorage
    const savedParams = JSON.parse(localStorage.getItem(`modelParams_${model.name}`) || '{}');
    
    if (isImageModel) {
        // Get saved parameters from localStorage
        const savedImageParams = JSON.parse(localStorage.getItem(`imageParams_${model}`) || '{}');
        
        // For image models, include chat functionality with custom parameters
        return `
            <div class="model-card" data-model-id="${model}">
                <div class="model-type image">Image Model</div>
                <div class="model-source">${SOURCES[source].name}</div>
                <h2 class="model-name">${model}</h2>
                <div class="capabilities">
                    <div class="capability">
                        <span class="capability-icon">✓</span>
                        <span>Image Generation</span>
                    </div>
                </div>
                <button class="chat-button">Chat</button>
                <div class="chat-section">
                    <div class="chat-messages-header">
                        <span>Chat History</span>
                        <div class="chat-controls">
                            <button class="fullscreen-button" title="Toggle fullscreen">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                                </svg>
                            </button>
                            <button class="clear-chat-button" title="Clear chat history">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M3 6h18"></path>
                                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                    <line x1="10" y1="11" x2="10" y2="17"></line>
                                    <line x1="14" y1="11" x2="14" y2="17"></line>
                                </svg>
                                Clear
                            </button>
                        </div>
                    </div>
                    <div class="chat-messages"></div>
                    <div class="chat-input-container">
                        <div class="model-params">
                            <div class="param-group">
                                <label for="width">Width:</label>
                                <input type="number" id="width" class="param-input" value="${savedImageParams.width || 1024}" min="1" max="1024">
                            </div>
                            <div class="param-group">
                                <label for="height">Height:</label>
                                <input type="number" id="height" class="param-input" value="${savedImageParams.height || 1024}" min="1" max="1024">
                            </div>
                            <div class="param-group">
                                <label for="seed">Seed:</label>
                                <input type="number" id="seed" class="param-input" value="${savedImageParams.seed || 42}">
                            </div>
                            <div class="param-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="one-shot" class="param-input" checked disabled>
                                    One-Shot
                                </label>
                            </div>
                        </div>
                        <div class="image-preview-container"></div>
                        <div class="input-row">
                            <input type="text" class="chat-input" placeholder="Describe the image you want to generate...">
                            <button class="chat-send">Generate</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    // For text models, use the existing card format
    const capabilities = getCapabilities(model);
    
    return `
        <div class="model-card" data-model-id="${model.name}">
            <div class="model-type ${isAudioModel ? 'audio' : 'text'}">${isAudioModel ? 'Audio Model' : 'Text Model'}</div>
            <div class="model-source">${SOURCES[source].name}</div>
            <h2 class="model-name">${model.name}</h2>
            <p class="model-description">${model.description}</p>
            <div class="capabilities">
                ${capabilities.map(capability => `
                    <div class="capability">
                        <span class="capability-icon">✓</span>
                        <span>${capability}</span>
                    </div>
                `).join('')}
            </div>
            <button class="chat-button">Chat</button>
            <div class="chat-section">
                <div class="chat-messages-header">
                    <span>Chat History</span>
                    <div class="chat-controls">
                        <button class="fullscreen-button" title="Toggle fullscreen">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                            </svg>
                        </button>
                        <button class="clear-chat-button" title="Clear chat history">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 6h18"></path>
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                            Clear
                        </button>
                    </div>
                </div>
                <div class="chat-messages"></div>
                <div class="chat-input-container">
                    ${isAudioModel ? `
                        <div class="voice-params">
                            <div class="param-group">
                                <label for="voice-selector">Voice:</label>
                                <select class="voice-selector" id="voice-selector">
                                    ${['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'verse', 'ballad', 'ash', 'sage', 'amuch', 'dan'].map(voice => `
                                        <option value="${voice}" ${voice === 'alloy' ? 'selected' : ''}>${voice.charAt(0).toUpperCase() + voice.slice(1)}</option>
                                    `).join('')}
                                </select>
                            </div>
                        </div>
                    ` : ''}
                    <div class="model-params">
                        <div class="param-group">
                            <label for="system-prompt">System Prompt:</label>
                            <textarea id="system-prompt" class="param-input" rows="2">${savedParams.systemPrompt || "You are a helpful assistant."}</textarea>
                        </div>
                        <div class="param-group">
                            <label for="temperature">Temperature:</label>
                            <input type="number" id="temperature" class="param-input" value="${savedParams.temperature || 0.9}" min="0" max="2" step="0.1">
                        </div>
                        <div class="param-group">
                            <label for="top-p">Top P:</label>
                            <input type="number" id="top-p" class="param-input" value="${savedParams.topP || 0.7}" min="0" max="1" step="0.1">
                        </div>
                        <div class="param-group">
                            <label for="max-tokens">Max Tokens:</label>
                            <input type="number" id="max-tokens" class="param-input" value="${savedParams.maxTokens || 500}" min="1" max="4096">
                        </div>
                        <div class="param-group">
                            <label for="seed">Seed:</label>
                            <input type="number" id="seed" class="param-input" value="${savedParams.seed || 42}">
                        </div>
                        <div class="param-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="one-shot" class="param-input" ${(isAudioModel || isImageModel) ? 'checked disabled' : (savedParams.oneShot ? 'checked' : '')}>
                                One-Shot
                            </label>
                        </div>
                    </div>
                    <div class="image-preview-container"></div>
                    <div class="input-row">
                        <button class="image-attach-button" title="Attach images">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                <polyline points="21 15 16 10 5 21"></polyline>
                            </svg>
                        </button>
                        <input type="text" class="chat-input" placeholder="Type your message...">
                        <button class="chat-send">Send</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function initializeImageParams(modelCard) {
    const modelId = modelCard.getAttribute('data-model-id');
    const paramInputs = modelCard.querySelectorAll('.param-input');
    
    paramInputs.forEach(input => {
        input.addEventListener('change', () => {
            const params = {
                width: modelCard.querySelector('#width').value,
                height: modelCard.querySelector('#height').value,
                seed: modelCard.querySelector('#seed').value
            };
            localStorage.setItem(`imageParams_${modelId}`, JSON.stringify(params));
        });
    });
}

function initializeChat(card, modelName) {
    const chatButton = card.querySelector('.chat-button');
    const chatSection = card.querySelector('.chat-section');
    const chatMessages = card.querySelector('.chat-messages');
    const chatInput = card.querySelector('.chat-input');
    const sendButton = card.querySelector('.chat-send');
    const imageAttachButton = card.querySelector('.image-attach-button');
    const imagePreviewContainer = card.querySelector('.image-preview-container');
    const voiceSelector = card.querySelector('.voice-selector');
    const clearChatButton = card.querySelector('.clear-chat-button');
    const fullscreenButton = card.querySelector('.fullscreen-button');
    
    // Initialize image parameters if this is an image model
    const modelTypeElement = card.querySelector('.model-type');
    if (modelTypeElement && modelTypeElement.textContent.trim() === 'Image Model') {
        initializeImageParams(card);
    }
    
    let messages = [];
    let isWaitingForResponse = false;
    let attachedImages = [];
    
    // Fullscreen toggle functionality
    if (fullscreenButton) {
        fullscreenButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent event bubbling
            const isFullscreen = chatSection.classList.contains('fullscreen');
            
            if (!isFullscreen) {
                // Enter fullscreen
                chatSection.classList.add('fullscreen');
                // Hide other chat sections
                document.querySelectorAll('.chat-section').forEach(section => {
                    if (section !== chatSection) {
                        section.style.display = 'none';
                    }
                });
                // Prevent scrolling on body
                document.body.style.overflow = 'hidden';
            } else {
                // Exit fullscreen
                chatSection.classList.remove('fullscreen');
                // Show all chat sections
                document.querySelectorAll('.chat-section').forEach(section => {
                    section.style.display = '';
                });
                // Restore body scrolling
                document.body.style.overflow = '';
            }
        });
    }
    
    // Clear chat functionality
    if (clearChatButton) {
        clearChatButton.addEventListener('click', () => {
            chatMessages.innerHTML = '';
            messages = [];
            attachedImages = [];
            if (imagePreviewContainer) {
                imagePreviewContainer.innerHTML = '';
            }
        });
    }
    
    // Check if this is an image model
    const modelCard = card.closest('.model-card');
    const modelType = modelCard.querySelector('.model-type');
    const isImageModel = modelType && modelType.textContent.trim() === 'Image Model';
    const isAudioModel = modelType && modelType.textContent.trim() === 'Audio Model';
    
    // Only show image attachment button if model supports image input and is not an image model
    const capabilities = modelCard.querySelectorAll('.capability span:last-child');
    const supportsImageInput = Array.from(capabilities).some(cap => cap.textContent === 'Image Input');
    if (imageAttachButton) {
        imageAttachButton.style.display = (supportsImageInput && !isImageModel) ? 'block' : 'none';
    }
    
    // Load saved voice selection for audio model
    if (voiceSelector) {
        const savedVoice = localStorage.getItem('selectedVoice');
        if (savedVoice) {
            voiceSelector.value = savedVoice;
        }
        
        // Save voice selection when changed
        voiceSelector.addEventListener('change', () => {
            localStorage.setItem('selectedVoice', voiceSelector.value);
        });
    }
    
    chatButton.addEventListener('click', () => {
        chatSection.classList.toggle('active');
        if (chatSection.classList.contains('active')) {
            chatInput.focus();
        }
    });
    
    function addMessage(content, isUser, images = [], responseTime = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user' : 'assistant'}`;
        
        if (isUser) {
            // Create content container
            const contentContainer = document.createElement('div');
            contentContainer.className = 'message-content';
            
            // Add text content
            if (content) {
                const textDiv = document.createElement('div');
                textDiv.textContent = content;
                contentContainer.appendChild(textDiv);
            }
            
            // Add image previews if there are any
            if (images.length > 0) {
                const imageContainer = document.createElement('div');
                imageContainer.className = 'message-images';
                images.forEach(imageData => {
                    const preview = document.createElement('div');
                    preview.className = 'image-preview';
                    
                    const img = document.createElement('img');
                    img.src = imageData;
                    preview.appendChild(img);
                    
                    imageContainer.appendChild(preview);
                });
                contentContainer.appendChild(imageContainer);
            }
            
            messageDiv.appendChild(contentContainer);
        } else {
            // Check if the content is an image URL (for image model responses)
            if (content.startsWith('blob:')) {
                const imageContainer = document.createElement('div');
                imageContainer.className = 'message-content';
                
                const preview = document.createElement('div');
                preview.className = 'image-preview generated-image';
                
                const img = document.createElement('img');
                img.src = content;
                preview.appendChild(img);
                
                // Add download button
                const downloadButton = document.createElement('button');
                downloadButton.className = 'download-button';
                downloadButton.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    Download
                `;
                downloadButton.onclick = () => downloadImage(content);
                preview.appendChild(downloadButton);
                
                imageContainer.appendChild(preview);
                messageDiv.appendChild(imageContainer);
                
                // Add response time if available
                if (responseTime) {
                    const responseTimeDiv = document.createElement('div');
                    responseTimeDiv.className = 'response-time';
                    responseTimeDiv.textContent = `RT: ${responseTime}s`;
                    messageDiv.appendChild(responseTimeDiv);
                }
            } else {
                // Regular text/markdown content
                messageDiv.innerHTML = marked.parse(content);
            }
        }
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    async function convertImageToBinary(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result); // This will be a data URL
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
    
    async function handleImageAttach(event) {
        if (!imageAttachButton || !imagePreviewContainer) return;
        
        const files = event.target.files;
        if (!files || files.length === 0) return;
        
        // Limit to 20 images
        const filesToProcess = Array.from(files).slice(0, 20 - attachedImages.length);
        
        for (const file of filesToProcess) {
            if (!file.type.startsWith('image/')) continue;
            
            try {
                const binaryData = await convertImageToBinary(file);
                attachedImages.push(binaryData);
                
                // Create preview
                const preview = document.createElement('div');
                preview.className = 'image-preview';
                
                const img = document.createElement('img');
                img.src = URL.createObjectURL(file);
                preview.appendChild(img);
                
                const removeButton = document.createElement('button');
                removeButton.className = 'remove-image';
                removeButton.innerHTML = '×';
                removeButton.onclick = () => {
                    const index = attachedImages.indexOf(binaryData);
                    if (index > -1) {
                        attachedImages.splice(index, 1);
                        preview.remove();
                    }
                };
                preview.appendChild(removeButton);
                
                imagePreviewContainer.appendChild(preview);
            } catch (error) {
                console.error('Error processing image:', error);
            }
        }
        
        // Focus the chat input after attaching images
        const chatInput = document.querySelector('.chat-input');
        if (chatInput) {
            chatInput.focus();
        }
    }
    
    if (imageAttachButton) {
        imageAttachButton.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.multiple = true;
            input.onchange = handleImageAttach;
            input.click();
        });
    }
    
    async function fetchGeneratedImage(prompt, modelCard) {
        const params = new URLSearchParams({
            nologo: 'true',
            private: 'true'
        });

        // Get custom parameters for image models
        if (modelCard) {
            const width = modelCard.querySelector('#width')?.value || '1024';
            const height = modelCard.querySelector('#height')?.value || '1024';
            const seed = modelCard.querySelector('#seed')?.value || '42';
            
            params.append('width', width);
            params.append('height', height);
            params.append('seed', seed);
        }
        
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
        
        try {
            const startTime = Date.now();
            const controller = new AbortController();
            activeRequestController = controller;

            const response = await fetch(url, {
                signal: controller.signal
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            
            const imageBlob = await response.blob();
            const endTime = Date.now();
            const responseTime = ((endTime - startTime) / 1000).toFixed(2);
            
            return {
                url: URL.createObjectURL(imageBlob),
                responseTime
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Image generation was cancelled');
                throw error;
            }
            console.error('Error fetching generated image:', error);
            throw error;
        } finally {
            activeRequestController = null;
        }
    }
    
    async function sendMessage() {
        if (isWaitingForResponse) {
            // If we're already waiting for a response, this means we want to stop it
            if (activeRequestController) {
                activeRequestController.abort();
                activeRequestController = null;
                isWaitingForResponse = false;
                sendButton.textContent = 'Send';
                sendButton.disabled = false;
                chatInput.disabled = false;
                if (imageAttachButton) imageAttachButton.disabled = false;
                
                // Add stopped note to the last message
                const lastMessage = chatMessages.lastElementChild;
                if (lastMessage && lastMessage.classList.contains('assistant')) {
                    const stoppedNote = document.createElement('div');
                    stoppedNote.className = 'stopped-note';
                    stoppedNote.textContent = 'Response stopped by user';
                    lastMessage.appendChild(stoppedNote);
                }
            }
            return;
        }
        
        const message = chatInput.value.trim();
        if (!message && attachedImages.length === 0) return;
        
        isWaitingForResponse = true;
        sendButton.textContent = 'Stop';
        sendButton.disabled = false;
        chatInput.disabled = true;
        if (imageAttachButton) imageAttachButton.disabled = true;
        
        // Add user message to chat
        addMessage(message, true, attachedImages);
        chatInput.value = '';
        
        // Clear image previews
        if (imagePreviewContainer) {
            imagePreviewContainer.innerHTML = '';
        }
        
        // Add to messages array
        const oneShot = modelCard.querySelector('#one-shot')?.checked || false;
        if (oneShot) {
            messages = [{ 
                role: 'user', 
                content: message,
                images: attachedImages 
            }];
        } else {
            messages.push({ 
                role: 'user', 
                content: message,
                images: attachedImages 
            });
        }
        
        // Clear attached images
        attachedImages = [];
        
        try {
            if (isImageModel) {
                // Add loading message with cancel button
                const loadingMessage = document.createElement('div');
                loadingMessage.className = 'message assistant loading';
                
                const loadingText = document.createElement('span');
                loadingText.className = 'loading-text';
                loadingText.textContent = '...';
                
                loadingMessage.appendChild(loadingText);
                chatMessages.appendChild(loadingMessage);
                chatMessages.scrollTop = chatMessages.scrollHeight;
                
                // For image models, generate an image
                const { url, responseTime } = await fetchGeneratedImage(message, modelCard);
                
                // Remove loading message
                loadingMessage.remove();
                
                addMessage(url, false, [], responseTime);
                messages.push({ role: 'assistant', content: url });
            } else if (isAudioModel) {
                // For audio models, use direct endpoint
                await streamChatCompletion(messages, modelName);
            } else {
                // For text models, use streaming
                await streamChatCompletion(messages, modelName);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Request was cancelled');
                return;
            }
            console.error('Error in chat:', error);
            addMessage('Sorry, there was an error processing your message.', false);
        } finally {
            isWaitingForResponse = false;
            sendButton.textContent = 'Send';
            sendButton.disabled = false;
            chatInput.disabled = false;
            if (imageAttachButton) imageAttachButton.disabled = false;
            chatInput.focus();
        }
    }
    
    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Stop newline
            sendMessage();
        }
        // Shift+Enter will just work as normal (new line)
    });
}

async function streamChatCompletion(messages, modelId) {
    const model = models.find(m => m.id === modelId || m.name === modelId);
    
    if (!model) {
        console.error('Model not found:', modelId);
        return;
    }

    // Get the chat container for this specific model
    const modelCard = document.querySelector(`[data-model-id="${modelId}"]`);
    if (!modelCard) {
        console.error('Model card not found:', modelId);
        return;
    }
    const chatContainer = modelCard.querySelector('.chat-messages');
    if (!chatContainer) {
        console.error('Chat container not found for model:', modelId);
        return;
    }

    // Get model parameters
    const systemPrompt = modelCard.querySelector('#system-prompt')?.value || "You are a helpful assistant.";
    const temperature = parseFloat(modelCard.querySelector('#temperature')?.value || 0.9);
    const topP = parseFloat(modelCard.querySelector('#top-p')?.value || 0.7);
    const maxTokens = parseInt(modelCard.querySelector('#max-tokens')?.value || 500);
    const seed = parseInt(modelCard.querySelector('#seed')?.value || 42);

    // Save parameters to localStorage
    const params = {
        systemPrompt,
        temperature,
        topP,
        maxTokens,
        seed
    };
    localStorage.setItem(`modelParams_${modelId}`, JSON.stringify(params));

    // Add loading message with cancel button
    const loadingMessage = document.createElement('div');
    loadingMessage.className = 'message assistant loading';
    
    const loadingText = document.createElement('span');
    loadingText.className = 'loading-text';
    loadingText.textContent = '...';
    
    loadingMessage.appendChild(loadingText);
    chatContainer.appendChild(loadingMessage);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    const startTime = Date.now();
    let messageDiv = null;
    let currentMessage = '';
    let isCancelled = false;

    try {
        // Create a new AbortController for this request
        const controller = new AbortController();
        activeRequestController = controller;

        // Special handling for searchgpt model
        if (modelId === 'searchgpt') {
            const lastMessage = messages[messages.length - 1].content;
            const searchUrl = `https://text.pollinations.ai/${encodeURIComponent(lastMessage)}?model=searchgpt&private=true`;
            
            const response = await fetch(searchUrl, {
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const text = await response.text();
            
            // Remove loading message
            loadingMessage.remove();
            
            // Create message div
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message assistant';
            
            // Parse markdown and add target="_blank" to all links
            const parsedHtml = marked.parse(text);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = parsedHtml;
            
            // Add target="_blank" to all links
            const links = tempDiv.getElementsByTagName('a');
            for (let link of links) {
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
            }
            
            messageDiv.innerHTML = tempDiv.innerHTML;
            chatContainer.appendChild(messageDiv);
            
            // Calculate and add response time
            const endTime = Date.now();
            const responseTime = ((endTime - startTime) / 1000).toFixed(2);
            const responseTimeDiv = document.createElement('div');
            responseTimeDiv.className = 'response-time';
            responseTimeDiv.textContent = `RT: ${responseTime}s`;
            messageDiv.appendChild(responseTimeDiv);
            
            chatContainer.scrollTop = chatContainer.scrollHeight;
            return;
        }

        // Special handling for openai-audio model
        if (modelId === 'openai-audio') {
            const voiceSelector = modelCard.querySelector('.voice-selector');
            const voice = voiceSelector ? voiceSelector.value : 'alloy';
            
            // Get system prompt
            const systemPrompt = modelCard.querySelector('#system-prompt')?.value || "You are a helpful assistant.";
            
            // Format the message with system prompt
            const formattedMessage = `${systemPrompt}\n\n${messages[messages.length - 1].content}`;
            
            const response = await fetch(`https://text.pollinations.ai/${encodeURIComponent(formattedMessage)}?model=openai-audio&voice=${voice}&private=true`, {
                method: 'GET',
                headers: {
                    'Accept': 'audio/mpeg'
                },
                signal: controller.signal
            });

            if (!response.ok) {
                loadingMessage.remove();
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            if (response.headers.get('Content-Type')?.includes('audio/mpeg')) {
                const audioBlob = await response.blob();
                const audioUrl = URL.createObjectURL(audioBlob);
                
                // Calculate response time
                const endTime = Date.now();
                const responseTime = ((endTime - startTime) / 1000).toFixed(2);
                
                // Remove loading message
                loadingMessage.remove();
                
                // Create audio player element
                const audioPlayer = document.createElement('div');
                audioPlayer.className = 'audio-player';
                audioPlayer.innerHTML = `
                    <audio controls autoplay>
                        <source src="${audioUrl}" type="audio/mpeg">
                        Your browser does not support the audio element.
                    </audio>
                    <div class="response-time">RT: ${responseTime}s</div>
                `;
                
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message assistant';
                messageDiv.appendChild(audioPlayer);
                chatContainer.appendChild(messageDiv);
                chatContainer.scrollTop = chatContainer.scrollHeight;
                
                // Add to messages array
                messages.push({ role: 'assistant', content: 'Audio response' });
            } else {
                loadingMessage.remove();
                const errorText = await response.text();
                console.error('Expected audio, received:', response.headers.get('Content-Type'), errorText);
                throw new Error('API did not return audio content');
            }
            return;
        }

        // Format messages for the API request
        const formattedMessages = messages.map(msg => {
            if (msg.images && msg.images.length > 0) {
                // If the message has images, format them properly
                const content = [
                    { type: "text", text: msg.content || "" }
                ];
                
                // Add each image to the content array
                msg.images.forEach(imageData => {
                    content.push({
                        type: "image_url",
                        image_url: { url: imageData }
                    });
                });
                
                return {
                    role: msg.role,
                    content: content
                };
            }
            
            return {
                role: msg.role,
                content: msg.content
            };
        });

        // Regular text streaming for other models
        const response = await fetch('https://text.pollinations.ai/openai?private=true', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model.id,
                messages: [
                    { role: "system", content: systemPrompt },
                    ...formattedMessages
                ],
                temperature,
                top_p: topP,
                max_tokens: maxTokens,
                seed,
                stream: true
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            loadingMessage.remove();
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6).trim();
                    if (dataStr === '[DONE]') {
                        continue;
                    }
                    
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
                            currentMessage += data.choices[0].delta.content;
                            
                            // Remove loading message and create message div on first content
                            if (!messageDiv) {
                                loadingMessage.remove();
                                messageDiv = document.createElement('div');
                                messageDiv.className = 'message assistant';
                                
                                chatContainer.appendChild(messageDiv);
                            }
                            
                            // Update message content
                            const contentDiv = document.createElement('div');
                            contentDiv.className = 'message-content';
                            contentDiv.innerHTML = marked.parse(currentMessage);
                            
                            // Replace or add the content div
                            const existingContent = messageDiv.querySelector('.message-content');
                            if (existingContent) {
                                existingContent.replaceWith(contentDiv);
                            } else {
                                messageDiv.appendChild(contentDiv);
                            }
                            
                            chatContainer.scrollTop = chatContainer.scrollHeight;
                        }
                    } catch (e) {
                        console.error('Error parsing stream data:', e);
                        continue;
                    }
                }
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Request was cancelled');
            return;
        }
        loadingMessage.remove();
        console.error('Error:', error);
        const errorMessage = document.createElement('div');
        errorMessage.className = 'message assistant';
        errorMessage.textContent = 'An error occurred while processing your request.';
        chatContainer.appendChild(errorMessage);
    } finally {
        activeRequestController = null;
    }
}

function getCapabilities(model) {
    const capabilities = [];
    
    // Input capabilities
    if (model.input_modalities?.includes('text')) {
        capabilities.push('Text Input');
    }
    if (model.input_modalities?.includes('image')) {
        capabilities.push('Image Input');
    }
    
    // Output capabilities
    if (model.output_modalities?.includes('text')) {
        capabilities.push('Text Output');
    }
    
    // Special capabilities
    if (model.vision) {
        capabilities.push('Vision Capabilities');
    }
    if (model.reasoning) {
        capabilities.push('Enhanced Reasoning');
    }
    if (model.uncensored) {
        capabilities.push('Uncensored');
    }
    
    return capabilities;
}

// Theme toggle functionality
document.addEventListener('DOMContentLoaded', () => {
    // Check for saved theme preference or use system preference
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    // Theme toggle button functionality
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }

    // Initialize the app
    fetchModels('pollinations');
    
    // Add search functionality
    const searchInput = document.getElementById('model-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const cards = document.querySelectorAll('.model-card');
            
            cards.forEach(card => {
                const cardText = card.textContent.toLowerCase();
                if (cardText.includes(searchTerm)) {
                    card.classList.remove('hidden');
                } else {
                    card.classList.add('hidden');
                }
            });
        });
    }

    // Initialize multi-chat after models are fetched
    fetchModels('pollinations').then(() => {
        // Initialize with all models deselected by default
        selectedModels.clear();
        initializeMultiChat();
    });
}); 