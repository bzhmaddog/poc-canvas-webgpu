import * as buffer from 'buffer';
(window as any).Buffer = buffer.Buffer;

let startTime = 0;
let frames = 0;
let lastFrames = 0;
let minFps = 1000; // to make sure we have the correct value
let maxFps = 0;


// Our DMD dots will be 4x4 pixels
// Whith a  1 pixel spacing between dots
const dotWidth = 4;
const dotHeight = 4;
const hSpace = 1;
const vSpace = 1;

// Our DMD will be 256 x 78 dots (my initial target was a 128x39 dots DMD but it wasn't looking good so I increased the resolution)
// Pinball DMD where usually 128x32 (WILLIAMS, BALLY, GOTLIEB, CAPCOM) or 256x64 (SEGA)
const dmdWidth = 256;
const dmdHeight = 78;
const dmdBufferByteLength = dmdWidth*dmdHeight * 4;

// Output canvas will be 1280x390
// Why ? because it is the native resolution of my target display (LTA149B780F)
const screenWidth = 1280;
const screenHeight = 390;
const screenBufferByteLength = screenWidth * screenHeight * 4;

let img1 = new Image();
img1.src = "game-over.webp";

let img2 = new Image();
img2.src = "game-over-clouds.webp";

// Create a video element
let vid1 = document.createElement('video');
vid1.src = "clouds.webm";
vid1.loop = true;

// Canvas where the DMD will be rendered
let outputCanvas = document.getElementById('outputCanvas') as HTMLCanvasElement;
let outputContext = outputCanvas.getContext('2d');

// Offscreen canvas used to composite the image and video together before generating the DMD output
let offscreenCanvas = document.createElement('canvas');
let bufferContext = offscreenCanvas.getContext('2d');

// 256x78
offscreenCanvas.width = dmdWidth;
offscreenCanvas.height = dmdHeight;

const fpsBox = document.getElementById('fpsBox');

initWebGPU().then(device => {
//    console.log(device);

    /**
     * The actual shader
     */
    const shaderModule = device.createShaderModule({
        code: `
            [[block]] struct Image {
                rgba: array<u32>;
            };
            [[group(0), binding(0)]] var<storage,read> inputPixels: Image;
            [[group(0), binding(1)]] var<storage,write> outputPixels: Image;
            [[stage(compute), workgroup_size(1)]]
            fn main ([[builtin(global_invocation_id)]] global_id: vec3<u32>) {
                var index : u32 = global_id.x + global_id.y *  ${dmdWidth}u;

                var pixel : u32 = inputPixels.rgba[index];
                
                let a : u32 = (pixel >> 24u) & 255u;
                let r : u32 = (pixel >> 16u) & 255u;
                let g : u32 = (pixel >> 8u) & 255u;
                let b : u32 = (pixel & 255u);
                //pixel = a << 24u | r << 16u | g << 8u | b;

                // Pixels that are too dark will be hacked to look like the background of the DMD
                if (r < 15u && g < 15u && b < 15u ) {
                    pixel = 4279176975u;
                    //pixel = 4278190335u;
                }

                // First byte index of the output dot
                var resizedPixelIndex : u32 = (global_id.x * ${dotWidth}u)  + (global_id.x * ${hSpace}u) + (global_id.y * ${screenWidth}u * (${dotHeight}u + ${vSpace}u));

                for ( var row: u32 = 0u ; row < ${dotHeight}u; row = row + 1u) {
                    for ( var col: u32 = 0u ; col < ${dotWidth}u; col = col + 1u) {
                        outputPixels.rgba[resizedPixelIndex] = pixel;
                        resizedPixelIndex = resizedPixelIndex + 1u;
                    }
                    resizedPixelIndex = resizedPixelIndex + ${screenWidth}u - ${dotWidth}u;
                }
            }
        `
    });


    /**
     * Main render method
     */
    function drawFrame() {

        bufferContext.drawImage(vid1, 0, 0, dmdWidth, dmdHeight);
        bufferContext.drawImage(img2, 0, 0, dmdWidth, dmdHeight);
        bufferContext.drawImage(img1, 0, 0, dmdWidth, dmdHeight);

        // Grab composited image
        const frameData = bufferContext.getImageData(0, 0, dmdWidth, dmdHeight);

        // Render DMD frame
        renderFrameWidthShader(frameData, device, shaderModule).then( imageData => {
            // put image data into output canvas
            outputContext.putImageData(imageData, 0, 0);

            renderFPS();

            // Request next frame
            requestAnimationFrame(drawFrame);
        });
    }


    function renderFPS() {
		// calculate FPS rate
		var now = new Date().getTime();
		var dt = now - startTime;
		var df = frames - lastFrames;

		startTime = now;
		lastFrames = frames;

		var fps = Math.round((df * 1000) / dt);

        if (frames > 60) {
            minFps = Math.min(minFps, fps);
        } else {
            minFps = fps;
        }

        maxFps = Math.max(maxFps, fps);

		frames++;

		fpsBox.innerHTML = `Min = ${minFps} / Max = ${maxFps} / current = ${fps}`;
	}

    // Start rendering on click
    document.getElementById('dButton').onclick = function() {
         // Start video play
        vid1.play();

        // Start animation
        requestAnimationFrame(drawFrame);
    };




});

/**
 * Not the way I think Is should work but for now
 * I don't understand why we have to recreate the buffers and layouts each frame
 * @param imageData Image data to be rendered
 * @param device 
 * @param shaderModule 
 * @returns 
 */
async function renderFrameWidthShader(imageData: ImageData, device: GPUDevice, shaderModule: GPUShaderModule): Promise<ImageData> {

    const gpuInputBuffer = device.createBuffer({
        mappedAtCreation: true,
        size: dmdBufferByteLength,
        usage: GPUBufferUsage.STORAGE
    });

    const gpuTempBuffer = device.createBuffer({
        size: screenBufferByteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    const gpuOutputBuffer = device.createBuffer({
        size: screenBufferByteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "read-only-storage"
                }
            } as GPUBindGroupLayoutEntry,
            {
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: {
                    type: "storage"
                }
            } as GPUBindGroupLayoutEntry
        ]
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: gpuInputBuffer
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: gpuTempBuffer
                }
            }
        ]
    });

    const computePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        }),
        compute: {
            module: shaderModule,
            entryPoint: "main"
        }
    });

    return new Promise( resolve => {

        // Put original image data in the input buffer (257x78)
        new Uint8Array(gpuInputBuffer.getMappedRange()).set(new Uint8Array(imageData.data));
        gpuInputBuffer.unmap();

        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(computePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatch(dmdWidth, dmdHeight);
        passEncoder.endPass();

        commandEncoder.copyBufferToBuffer(gpuTempBuffer, 0, gpuOutputBuffer, 0, screenBufferByteLength);

        device.queue.submit([commandEncoder.finish()]);

        // Render DMD output
        gpuOutputBuffer.mapAsync(GPUMapMode.READ).then( () => {

            // Grab data from output buffer
            const pixelsBuffer = new Uint8Array(gpuOutputBuffer.getMappedRange());

            // Generate Image data usable by a canvas
            const imageData = new ImageData(new Uint8ClampedArray(pixelsBuffer), screenWidth, screenHeight);

            // return to caller
            resolve(imageData);
        });
    });
}

/**
 * Async method to initialize webgpu internals
 * @returns GPUDevice
 */
async function initWebGPU() : Promise<GPUDevice> {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    return new Promise(resolve => {
        resolve(device);
    });    
}
