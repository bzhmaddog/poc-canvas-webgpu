import { decode, encode, RawImageData, BufferLike } from 'jpeg-js'
import * as buffer from 'buffer';
(window as any).Buffer = buffer.Buffer;

const dotWidth = 4;
const dotHeight = 4;
const hSpace = 1;
const vSpace = 1;


const dmdWidth = 256;
const dmdHeight = 78;
const dmdBufferByteLength = dmdWidth*dmdHeight * 4;

const screenWidth = 1280;
const screenHeight = 390;
const screenBufferByteLength = screenWidth * screenHeight * 4;


//let video = document.getElementById('inputVideo') as HTMLVideoElement;
let img = new Image();

img.src = "title.webp";


let outputCanvas = document.getElementById('outputCanvas') as HTMLCanvasElement;
let offscreenCanvas = document.createElement('canvas');
let bufferContext = offscreenCanvas.getContext('2d');
let outputContext = outputCanvas.getContext('2d');


offscreenCanvas.width = dmdWidth;
offscreenCanvas.height = dmdHeight;


function drawFrameInCanvas() {
    //bufferContext.drawImage(video, 0, 0, w, h);
    bufferContext.drawImage(img, 0, 0, dmdWidth, dmdHeight);
    //let frameImageData = bufferContext.getImageData(0, 0, w, h);
//     return frameImageData;

    requestAnimationFrame(drawFrameInCanvas);
}

requestAnimationFrame(drawFrameInCanvas);

//requestAnimationFrame(draw);

initWebGPU().then(device => {
//    console.log(device);


    // INIT BUFFERS
    const gpuInputBuffer = device.createBuffer({
        mappedAtCreation: true,
        size: dmdBufferByteLength,
        usage: GPUBufferUsage.STORAGE
    });

    const gpuResultBuffer = device.createBuffer({
        size: screenBufferByteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    const gpuReadBuffer = device.createBuffer({
        size: screenBufferByteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    // BINDING GROUP LAYOUT
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
                    buffer: gpuResultBuffer
                }
            }
        ]
    });


    // SHADER
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

                // First byte index of the output dot
                var resizedPixelIndex : u32 = (global_id.x * ${dotWidth}u)  + (global_id.x * ${hSpace}u) + (global_id.y * ${screenWidth}u * (${dotHeight}u + ${vSpace}u));

                for ( var row: u32 = 0u ; row < ${dotHeight}u; row = row + 1u) {
                    for ( var col: u32 = 0u ; col < ${dotWidth}u; col = col + 1u) {
                        outputPixels.rgba[resizedPixelIndex] = inputPixels.rgba[index];
                        resizedPixelIndex = resizedPixelIndex + 1u;
                    }
                    resizedPixelIndex = resizedPixelIndex + ${screenWidth}u - ${dotWidth}u;
                }
            }
        `
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


    function draw() {
//        const frameData = drawFrameInCanvas();
        const frameData = bufferContext.getImageData(0, 0, dmdWidth, dmdHeight);

        //console.log(new Uint8Array(frameData.data));

//        gpuInputBuffer.mapAsync(GPUMapMode.READ);
        new Uint8Array(gpuInputBuffer.getMappedRange()).set(new Uint8Array(frameData.data));
        gpuInputBuffer.unmap();

        // START COMPUTE PASS
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(computePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatch(dmdWidth, dmdHeight);
        passEncoder.endPass();

        commandEncoder.copyBufferToBuffer(gpuResultBuffer, 0, gpuReadBuffer, 0, screenBufferByteLength);

        device.queue.submit([commandEncoder.finish()]);

        gpuReadBuffer.mapAsync(GPUMapMode.READ).then( () => {

            const pixels = new Uint8Array(gpuReadBuffer.getMappedRange());
            //console.log(pixels);
            const imageData = new ImageData(new Uint8ClampedArray(pixels), screenWidth, screenHeight);
            outputContext.putImageData(imageData, 0, 0);

/*            gpuInputBuffer.mapAsync(GPUMapMode.READ).then( () => {
                requestAnimationFrame(draw);
                console.log('here');
            });*/
        });
    }

    document.getElementById('dButton').onclick = function() {
        requestAnimationFrame(draw);
    };
  

//    requestAnimationFrame(draw);


});




async function initWebGPU() : Promise<GPUDevice> {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    return new Promise(resolve => {
        resolve(device);
    });    
}
