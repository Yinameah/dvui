function dvui(canvasId, wasmFile) {

  const vertexShaderSource = `# version 300 es

    precision mediump float;

    in vec4 aVertexPosition;
    in vec4 aVertexColor;
    in vec2 aTextureCoord;

    uniform mat4 uMatrix;

    out vec4 vColor;
    out vec2 vTextureCoord;

    void main() {
      gl_Position = uMatrix * aVertexPosition;
      vColor = aVertexColor / 255.0;  // normalize u8 colors to 0-1
      vColor.rgb *= vColor.a;  // convert to premultiplied alpha
      vTextureCoord = aTextureCoord;
    }
  `;

  const fragmentShaderSource = `# version 300 es

    precision mediump float;

    in vec4 vColor;
    in vec2 vTextureCoord;

    uniform sampler2D uSampler;
    uniform bool useTex;

    out vec4 fragColor;

    void main() {
        if (useTex) {
            fragColor = texture(uSampler, vTextureCoord);
        }
        else {
            fragColor = vColor;
        }
    }
  `;

    let gl;
    let indexBuffer;
    let vertexBuffer;
    let shaderProgram;
    let programInfo;
    const textures = new Map();
    let newTextureId = 1;

    let wasmResult;
    let log_string = '';

    const utf8decoder = new TextDecoder();
    const utf8encoder = new TextEncoder();

    const imports = {
      env: {
        wasm_panic: (ptr, len) => {
          let msg = utf8decoder.decode(new Uint8Array(wasmResult.instance.exports.memory.buffer, ptr, len));
          throw Error(msg);
        },
        wasm_log_write: (ptr, len) => {
          log_string += utf8decoder.decode(new Uint8Array(wasmResult.instance.exports.memory.buffer, ptr, len));
        },
        wasm_log_flush: () => {
          console.log(log_string);
          log_string = '';
        },
        wasm_now_f64() {
          return Date.now();
        },
        wasm_textureCreate(pixels, width, height) {
          const pixelData = new Uint8Array(wasmResult.instance.exports.memory.buffer, pixels, width * height * 4);

          const texture = gl.createTexture();
          const id = newTextureId;
            console.log("creating texture " + id);
          newTextureId += 1;
          textures.set(id, texture);
          
          gl.bindTexture(gl.TEXTURE_2D, texture);

            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.RGBA,
                width,
                height,
                0,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixelData,
            );

          gl.generateMipmap(gl.TEXTURE_2D);

          return id;
        },
        wasm_textureDestroy(id) {
            console.log("deleting texture " + id);
          const texture = textures.get(id);
          textures.delete(id);
          
          gl.deleteTexture(texture);
        },
        wasm_renderGeometry(textureId, index_ptr, index_len, vertex_ptr, vertex_len, sizeof_vertex, offset_pos, offset_col, offset_uv) {
            console.log("renderGeometry " + textureId + " sizeof " + sizeof_vertex + " pos " + offset_pos + " col " + offset_col + " uv " + offset_uv);

          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
          const indices = new Uint32Array(wasmResult.instance.exports.memory.buffer, index_ptr, index_len / 4);
          gl.bufferData( gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

          gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
          const vertexes = new Uint8Array(wasmResult.instance.exports.memory.buffer, vertex_ptr, vertex_len);
          gl.bufferData( gl.ARRAY_BUFFER, vertexes, gl.STATIC_DRAW);

          let matrix = new Float32Array(16);
          matrix[0] = 2.0 / gl.canvas.clientWidth;
          matrix[1] = 0.0;
          matrix[2] = 0.0;
          matrix[3] = 0.0;
          matrix[4] = 0.0;
          matrix[5] = -2.0 / gl.canvas.clientHeight;
          matrix[6] = 0.0;
          matrix[7] = 0.0;
          matrix[8] = 0.0;
          matrix[9] = 0.0;
          matrix[10] = 1.0;
          matrix[11] = 0.0;
          matrix[12] = -1.0;
          matrix[13] = 1.0;
          matrix[14] = 0.0;
          matrix[15] = 1.0;

          // vertex
          gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
          gl.vertexAttribPointer(
            programInfo.attribLocations.vertexPosition,
            2,  // num components
            gl.FLOAT,
            false,  // don't normalize
            sizeof_vertex,  // stride
            offset_pos,  // offset
          );
          gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

          // color
          gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
          gl.vertexAttribPointer(
            programInfo.attribLocations.vertexColor,
            4,  // num components
            gl.UNSIGNED_BYTE,
            false,  // don't normalize
            sizeof_vertex, // stride
            offset_col,  // offset
          );
          gl.enableVertexAttribArray(programInfo.attribLocations.vertexColor);

          // texture
          gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
          gl.vertexAttribPointer(
            programInfo.attribLocations.textureCoord,
            2,  // num components
            gl.FLOAT,
            false,  // don't normalize
            sizeof_vertex, // stride
            offset_uv,  // offset
          );
          gl.enableVertexAttribArray(programInfo.attribLocations.textureCoord);

          // Tell WebGL to use our program when drawing
          gl.useProgram(shaderProgram);

          // Set the shader uniforms
          gl.uniformMatrix4fv(
            programInfo.uniformLocations.matrix,
            false,
            matrix,
          );

            if (textureId != 0) {
                console.log("using texture " + textureId);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, textures.get(textureId));
                gl.uniform1i(programInfo.uniformLocations.useTex, 1);
            } else {
                gl.uniform1i(programInfo.uniformLocations.useTex, 0);
            }

            gl.uniform1i(programInfo.uniformLocations.uSampler, 0);

            gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
        },

        //createTexture() {
        //  const texture = gl.createTexture();
        //  gl.bindTexture(gl.TEXTURE_2D, texture);

        //  // Because images have to be downloaded over the internet
        //  // they might take a moment until they are ready.
        //  // Until then put a single pixel in the texture so we can
        //  // use it immediately. When the image has finished downloading
        //  // we'll update the texture with the contents of the image.
        //  const level = 0;
        //  const internalFormat = gl.RGBA;
        //  const width = 1;
        //  const height = 1;
        //  const border = 0;
        //  const srcFormat = gl.RGBA;
        //  const srcType = gl.UNSIGNED_BYTE;
        //  const pixel = new Uint8Array([0, 0, 255, 255]); // opaque blue
        //  gl.texImage2D(
        //    gl.TEXTURE_2D,
        //    level,
        //    internalFormat,
        //    width,
        //    height,
        //    border,
        //    srcFormat,
        //    srcType,
        //    pixel,
        //  );
        //},
      },
    };

    fetch(wasmFile)
    .then((response) => response.arrayBuffer())
    .then((bytes) => WebAssembly.instantiate(bytes, imports))
    .then(result => {

        wasmResult = result;

        console.log(wasmResult.instance.exports);

        let init_result = wasmResult.instance.exports.app_init();
        console.log("init result " + init_result);

          const canvas = document.querySelector(canvasId);
          // Initialize the GL context
          gl = canvas.getContext("webgl2", { alpha: true });

          // Only continue if WebGL is available and working
          if (gl === null) {
            alert("Unable to initialize WebGL. Your browser or machine may not support it.");
            return;
          }

          const vertexShader = gl.createShader(gl.VERTEX_SHADER);
          gl.shaderSource(vertexShader, vertexShaderSource);
          gl.compileShader(vertexShader);
          if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            alert(`Error compiling vertex shader: ${gl.getShaderInfoLog(shader)}`);
            gl.deleteShader(vertexShader);
            return null;
          }

          const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
          gl.shaderSource(fragmentShader, fragmentShaderSource);
          gl.compileShader(fragmentShader);
          if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
            alert(`Error compiling fragment shader: ${gl.getShaderInfoLog(shader)}`);
            gl.deleteShader(fragmentShader);
            return null;
          }

          shaderProgram = gl.createProgram();
          gl.attachShader(shaderProgram, vertexShader);
          gl.attachShader(shaderProgram, fragmentShader);
          gl.linkProgram(shaderProgram);

          if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
            alert(`Error initializing shader program: ${gl.getProgramInfoLog(shaderProgram)}`);
            return null;
          }

        programInfo = {
          attribLocations: {
            vertexPosition: gl.getAttribLocation(shaderProgram, "aVertexPosition"),
            vertexColor: gl.getAttribLocation(shaderProgram, "aVertexColor"),
            textureCoord: gl.getAttribLocation(shaderProgram, "aTextureCoord"),
          },
          uniformLocations: {
            matrix: gl.getUniformLocation(shaderProgram, "uMatrix"),
            uSampler: gl.getUniformLocation(shaderProgram, "uSampler"),
            useTex: gl.getUniformLocation(shaderProgram, "useTex"),
          },
        };

        indexBuffer = gl.createBuffer();
        vertexBuffer = gl.createBuffer();

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        function render() {
          gl.clearColor(0.0, 0.0, 0.0, 1.0); // Clear to black, fully opaque
          gl.clear(gl.COLOR_BUFFER_BIT);

          wasmResult.instance.exports.app_update();

            //requestAnimationFrame(render);
        }

        requestAnimationFrame(render);

    });
}

