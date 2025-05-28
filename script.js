document.addEventListener('DOMContentLoaded', () => {
    const imageUpload = document.getElementById('imageUpload');
    const uploadedImageEl = document.getElementById('uploadedImage');
    const uploadPrompt = document.getElementById('uploadPrompt');
    
    const generateButton = document.getElementById('generateButton');
    const statusMessage = document.getElementById('statusMessage');
    
    const aiDescriptionEl = document.getElementById('aiDescription');
    
    const generatedImageEl = document.getElementById('generatedImage');
    const generatePrompt = document.getElementById('generatePrompt');

    const cellShadedCanvas = document.getElementById('cellShadedCanvas');
    const cellShaderPrompt = document.getElementById('cellShaderPrompt');
    const ctx = cellShadedCanvas.getContext('2d');

    let uploadedImageDataUrl = null;
    let originalImageWidth = 300; // Default
    let originalImageHeight = 300; // Default

    imageUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                uploadedImageDataUrl = e.target.result;
                uploadedImageEl.src = uploadedImageDataUrl;
                uploadedImageEl.style.display = 'block';
                uploadPrompt.style.display = 'none';
                
                const img = new Image();
                img.onload = () => {
                    originalImageWidth = img.width;
                    originalImageHeight = img.height;
                }
                img.src = uploadedImageDataUrl;

                generateButton.disabled = false;
                statusMessage.textContent = 'Image loaded. Ready to generate.';
                // Clear previous results
                aiDescriptionEl.value = '';
                generatedImageEl.style.display = 'none';
                generatePrompt.style.display = 'block';
                ctx.clearRect(0, 0, cellShadedCanvas.width, cellShadedCanvas.height);
                cellShadedCanvas.style.display = 'none';
                cellShaderPrompt.style.display = 'block';

            };
            reader.readAsDataURL(file);
        }
    });

    generateButton.addEventListener('click', async () => {
        if (!uploadedImageDataUrl) {
            statusMessage.textContent = 'Please upload an image first.';
            return;
        }

        generateButton.disabled = true;
        statusMessage.textContent = 'Analyzing image with AI...';
        aiDescriptionEl.value = '';
        generatedImageEl.style.display = 'none';
        generatePrompt.style.display = 'block';
        ctx.clearRect(0, 0, cellShadedCanvas.width, cellShadedCanvas.height);
        cellShadedCanvas.style.display = 'none';
        cellShaderPrompt.style.display = 'block';


        try {
            // 1. Get AI Description
            const descriptionResponse = await websim.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `You are an expert image analyst. Describe the human in the provided image in detail. Focus on their apparent age range, gender presentation, hair style and color, eye color if visible, clothing style and color, pose, facial expression, and any notable accessories. Also describe the immediate background and lighting if relevant. The description should be suitable for an AI image generator to create a similar image. Respond directly with JSON, following this JSON schema, and no other text: { "description": "string" }`,
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Analyze this image of a human." },
                            { type: "image_url", image_url: { url: uploadedImageDataUrl } },
                        ],
                    },
                ],
                json: true,
            });

            const result = JSON.parse(descriptionResponse.content);
            const description = result.description;
            aiDescriptionEl.value = description;
            statusMessage.textContent = 'Description generated. Now generating image...';

            // 2. Generate Image with AI
            const imageGenResult = await websim.imageGen({
                prompt: description,
                width: originalImageWidth > 512 ? 512 : originalImageWidth, // Cap size for performance/cost
                height: originalImageHeight > 512 ? 512 : originalImageHeight, // Cap size for performance/cost
            });
            
            const generatedImageUrl = imageGenResult.url;
            generatedImageEl.src = generatedImageUrl;
            generatedImageEl.style.display = 'block';
            generatePrompt.style.display = 'none';
            statusMessage.textContent = 'Image generated. Applying cell shader...';

            // 3. Apply Cell Shader
            const genImg = new Image();
            genImg.crossOrigin = "Anonymous"; // Important for canvas operations on remote images
            genImg.onload = () => {
                cellShadedCanvas.width = genImg.width;
                cellShadedCanvas.height = genImg.height;
                applyCellShader(genImg);
                cellShadedCanvas.style.display = 'block';
                cellShaderPrompt.style.display = 'none';
                statusMessage.textContent = 'Cell shading complete!';
                generateButton.disabled = false;
            };
            genImg.onerror = () => {
                statusMessage.textContent = 'Error loading generated image for cell shading.';
                generateButton.disabled = false;
            };
            genImg.src = generatedImageUrl; // Ensure this is a CORS-friendly URL or handle potential issues

        } catch (error) {
            console.error('Error during AI processing:', error);
            statusMessage.textContent = `Error: ${error.message || 'An unknown error occurred.'}`;
            generateButton.disabled = false;
        }
    });

    function applyCellShader(img) {
        // Draw image to a temporary canvas to get pixel data
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0, img.width, img.height);
        const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
        const data = imageData.data;

        const outputImageData = ctx.createImageData(img.width, img.height);
        const outputData = outputImageData.data;

        const levels = 4; // Number of color levels for posterization
        const edgeThreshold = 30; // Threshold for edge detection (luminance difference)

        function posterize(value) {
            return Math.round(value / 255 * (levels - 1)) * Math.floor(255 / (levels - 1));
        }

        function getLuminance(r, g, b) {
            return 0.299 * r + 0.587 * g + 0.114 * b;
        }

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const pr = posterize(r);
            const pg = posterize(g);
            const pb = posterize(b);

            // Store posterized color first
            outputData[i] = pr;
            outputData[i + 1] = pg;
            outputData[i + 2] = pb;
            outputData[i + 3] = 255; // Alpha
        }
        
        // Second pass for edges (applied over posterized image)
        // For simplicity, we'll read from the outputData which is now posterized
        const tempEdgeData = new Uint8ClampedArray(outputData); // Copy for reading posterized values

        for (let y = 0; y < img.height; y++) {
            for (let x = 0; x < img.width; x++) {
                const idx = (y * img.width + x) * 4;

                const currentLuminance = getLuminance(tempEdgeData[idx], tempEdgeData[idx+1], tempEdgeData[idx+2]);
                
                let isEdge = false;

                // Check right neighbor
                if (x < img.width - 1) {
                    const rightIdx = (y * img.width + (x + 1)) * 4;
                    const rightLuminance = getLuminance(tempEdgeData[rightIdx], tempEdgeData[rightIdx+1], tempEdgeData[rightIdx+2]);
                    if (Math.abs(currentLuminance - rightLuminance) > edgeThreshold) {
                        isEdge = true;
                    }
                }

                // Check bottom neighbor
                if (!isEdge && y < img.height - 1) {
                    const bottomIdx = ((y + 1) * img.width + x) * 4;
                    const bottomLuminance = getLuminance(tempEdgeData[bottomIdx], tempEdgeData[bottomIdx+1], tempEdgeData[bottomIdx+2]);
                    if (Math.abs(currentLuminance - bottomLuminance) > edgeThreshold) {
                        isEdge = true;
                    }
                }
                
                if (isEdge) {
                    outputData[idx] = 0;     // R = black
                    outputData[idx + 1] = 0; // G = black
                    outputData[idx + 2] = 0; // B = black
                }
            }
        }


        ctx.putImageData(outputImageData, 0, 0);
    }
});

