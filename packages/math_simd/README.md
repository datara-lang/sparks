# math_simd

Hardware-accelerated SIMD vector and matrix math engine in Datara.

## Overview
Built directly on Datara's first-class SIMD types (`float4`, `int4`, and hardware `dot` instructions).
Designed for game physics, neural network embedding vector comparisons, and 3D graphics rendering pipelines.

## Features
- **`Vec4`**: 128-bit aligned 4-lane single precision vector with hardware SIMD operations.
- **`Mat4`**: 4x4 transformation matrix with hardware dot-product transforms.
- **Pure CPU Compute**: Requires 0 system capabilities.

## Usage Example
```datara
use sparks/math_simd

fn main() {
    let position = math_simd.Vec4.new(10.0, 20.0, 30.0, 1.0)
    let model_matrix = math_simd.Mat4.identity()
    let transformed = model_matrix.transform(position)
    println(transformed.data)
}
```
