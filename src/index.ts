import { decode, encode, RawImageData, BufferLike } from 'jpeg-js'
import * as buffer from 'buffer';
(window as any).Buffer = buffer.Buffer;

let video = document.getElementById('inputVideo') as HTMLVideoElement;
let outputCanvas = document.getElementById('outputCanvas') as HTMLCanvasElement;
let offscreenCanvas = document.createElement('canvas');
let bufferContext = offscreenCanvas.getContext('2d');
let outputContext = outputCanvas.getContext('2d');

let w = 480;
let h = 270;
const bufferByteLength = w*h*4;

offscreenCanvas.width = w;
offscreenCanvas.height = h;


function drawFrameInCanvas() {
    bufferContext.drawImage(video, 0, 0, w, h);
    //let frameImageData = bufferContext.getImageData(0, 0, w, h);
//     return frameImageData;

    requestAnimationFrame(drawFrameInCanvas);
}

requestAnimationFrame(drawFrameInCanvas);

//requestAnimationFrame(draw);

initWebGPU().then(device => {
//    console.log(device);


    // INIT BUFFERS
    const sizeArray= new Int32Array([w, h]);

    const gpuInputBuffer = device.createBuffer({
        mappedAtCreation: true,
        size: bufferByteLength,
        usage: GPUBufferUsage.STORAGE
    });

    const gpuResultBuffer = device.createBuffer({
        size: bufferByteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    const gpuReadBuffer = device.createBuffer({
        size: bufferByteLength,
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
                var width : u32 = 256u;
                let index : u32 = global_id.x + global_id.y * width;
                outputPixels.rgba[index] = inputPixels.rgba[index];
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
        const frameData = bufferContext.getImageData(0, 0, w, h);

        //console.log(new Uint8Array(frameData.data));

//        gpuInputBuffer.mapAsync(GPUMapMode.READ);
        new Uint8Array(gpuInputBuffer.getMappedRange()).set(new Uint8Array(frameData.data));
        gpuInputBuffer.unmap();

        // START COMPUTE PASS
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(computePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatch(w, h);
        passEncoder.endPass();

        commandEncoder.copyBufferToBuffer(gpuResultBuffer, 0, gpuReadBuffer, 0, bufferByteLength);

        device.queue.submit([commandEncoder.finish()]);

        gpuReadBuffer.mapAsync(GPUMapMode.READ).then( () => {

            const pixels = new Uint8Array(gpuReadBuffer.getMappedRange());
            const imageData = new ImageData(new Uint8ClampedArray(pixels), w, h);
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

    document.getElementById('test').onclick = function() {
        const frameData = bufferContext.getImageData(0, 0, w, h);
        outputContext.putImageData(frameData, 0, 0);
    }
    

//    requestAnimationFrame(draw);


});




async function initWebGPU() : Promise<GPUDevice> {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    return new Promise(resolve => {
        resolve(device);
    });
    
}


/*function imageSelected (event: Event) {
    const files = this.files;
    
    if (!files || files.length < 1) {
        return;
    }
    if (files[0].type != 'image/jpeg') {
        console.log('file is not a jpeg!');
        return;
    }

    const dataUrlReader = new FileReader();
    dataUrlReader.addEventListener('load', function () {
     (document.getElementById('inputimage') as HTMLImageElement).src = dataUrlReader.result as string;   
    });
    dataUrlReader.readAsDataURL(files[0]);

    const arrayReader = new FileReader();
    arrayReader.addEventListener('load', function () {
        const d = decode(arrayReader.result as ArrayBuffer);
        processImage(new Uint8Array(d.data), d.width, d.height). then(result => {
            // ENCODE TO JPEG DATA
            const resultImage: RawImageData<BufferLike> = {
                width: d.width,
                height: d.height,
                data: result
            }
            const encoded = encode(resultImage, 100)

            // AS DATA URL
            let binary = '';
            var bytes = new Uint8Array(encoded.data);
            var len = bytes.byteLength;
            for (var i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            let processed = 'data:' + files[0].type + ';base64,'
            processed += window.btoa(binary);

            // ASSIGN DATA URL TO OUTPUT IMAGE ELEMENT
            (document.getElementById('outputimage') as HTMLImageElement).src = processed
        });
    })
    arrayReader.readAsArrayBuffer(files[0]);
}*/


/*async function processImage (array: Uint8ClampedArray, width: number, height: number) : Promise<Uint8Array> {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    return new Promise(resolve => {
        // INIT BUFFERS
        const sizeArray= new Int32Array([width, height]);
        const gpuWidthHeightBuffer = device.createBuffer({
            mappedAtCreation: true,
            size: sizeArray.byteLength,
            usage: GPUBufferUsage.STORAGE
        });
        new Int32Array(gpuWidthHeightBuffer.getMappedRange()).set(sizeArray);
        gpuWidthHeightBuffer.unmap();

        const gpuInputBuffer = device.createBuffer({
            mappedAtCreation: true,
            size: array.byteLength,
            usage: GPUBufferUsage.STORAGE
        });
        new Uint8Array(gpuInputBuffer.getMappedRange()).set(array);
        gpuInputBuffer.unmap();

        const gpuResultBuffer = device.createBuffer({
            size: array.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const gpuReadBuffer = device.createBuffer({
            size: array.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        // BINDING GROUP LAYOUT
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer : {
                        type: "read-only-storage"
                    }
                } as GPUBindGroupLayoutEntry,
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: "read-only-storage"
                    }
                } as GPUBindGroupLayoutEntry,
                {
                    binding: 2,
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
                        buffer: gpuWidthHeightBuffer
                    }
                },
                {
                    binding: 1,
                    resource: {
                        buffer: gpuInputBuffer
                    }
                },
                {
                    binding: 2,
                    resource: {
                        buffer: gpuResultBuffer
                    }
                }
            ]
        });



        // START COMPUTE PASS
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(computePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatch(width, height);
        passEncoder.endPass();

        commandEncoder.copyBufferToBuffer(gpuResultBuffer, 0, gpuReadBuffer, 0, array.byteLength);

        device.queue.submit([commandEncoder.finish()]);

        gpuReadBuffer.mapAsync(GPUMapMode.READ).then( () => {
            resolve(new Uint8Array(gpuReadBuffer.getMappedRange()));
        });
    });
}*/