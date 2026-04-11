---
name: shader-validate
description: Validate and cross-compile GLSL, WGSL, and SPIR-V shaders using naga. Use when writing shaders, checking shader compilation, debugging shader errors, converting between shader languages, or verifying WebGL/WebGPU shader code.
compatibility: Requires naga-cli (cargo install naga-cli)
metadata:
  author: ridgeline
  version: "1.0"
---

# Shader Validation

Validate and cross-compile shaders using naga — a fast Rust-based shader translator supporting WGSL, GLSL, SPIR-V, MSL, and HLSL.

## Validating a shader

```bash
naga my_shader.wgsl
naga my_shader.frag
naga my_shader.vert
```

Exit code 0 means the shader is valid. Non-zero prints error details with line numbers.

## Cross-compiling shaders

Convert between shader languages by specifying input and output files:

```bash
# WGSL to SPIR-V
naga shader.wgsl shader.spv

# GLSL to WGSL
naga shader.frag shader.wgsl

# SPIR-V to Metal
naga shader.spv shader.metal

# WGSL to GLSL (with profile)
naga shader.wgsl shader.frag --profile es310
```

The output format is determined by file extension.

## Common GLSL validation

For WebGL fragment shaders:

```bash
naga my_effect.frag
```

For vertex shaders:

```bash
naga my_mesh.vert
```

## Batch validation

Validate all shaders in a directory:

```bash
find src/shaders -name '*.frag' -o -name '*.vert' -o -name '*.wgsl' | xargs -I {} naga {}
```

## Common errors

- **"unknown type"**: Missing uniform/varying declaration or typo in type name
- **"expected ';'"**: Missing semicolon (GLSL) or syntax mismatch
- **"binding collision"**: Two resources share the same binding index
- **"entry point not found"**: Missing `main` function (GLSL) or `@vertex`/`@fragment` annotation (WGSL)

## Gotchas

- naga's GLSL support requires the shader stage to be inferred from the file extension (`.vert`, `.frag`, `.comp`). Use the correct extension.
- WGSL is the native format — validation is most thorough for WGSL input.
- naga does not execute shaders. It checks syntax, types, and resource bindings — not runtime behavior.
