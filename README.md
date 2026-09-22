# HACKERS3D

A cyberpunk-style 3D visualization and management tool for a real filesystem.

## Features

- Real filesystem scanning with recursive directory discovery
- 3D force-directed filesystem graph
- FPS navigation with WASD / mouse
- SPACE to fly up
- SHIFT+SPACE to fly down
- SHIFT for boost
- Hover details for files and directories
- Node selection and relationship highlighting
- Parent/child navigation with **P / C**
- Sibling navigation with **[ / ]**
- Filesystem search with **Ctrl+F**
- Rename and delete operations
- Open files and directories through the host OS
- Live filesystem updates through a recursive watcher and SSE
- Cyberpunk HACKERS3D HUD
- Large-graph performance safeguards, including adaptive physics, LOD geometry, link-update throttling, visibility culling and throttled raycasts

## Requirements

- Go 1.17+
- Modern web browser with WebGL and EventSource support

## Installation

Clone the repository:

```bash
git clone https://github.com/msavinov2011-wq/Hackers3D.git
cd Hackers3D
```

Build:

```bash
go build -o hackers3d .
```

## Usage

Run Hackers3D with the directory you want to visualize:

```bash
./hackers3d /path/to/directory
```

On Windows:

```powershell
hackers3d.exe C:\Users\YourName\Documents
```

Then open:

```text
http://localhost:8080
```

### Command Line Options

```text
-port int
    Port to serve on (default 8080)

-hidden
    Show hidden files and directories

-ignore string
    Comma-separated list of directories to ignore
    Example: "node_modules,dist,build"
```

Example:

```bash
./hackers3d -port 8888 -hidden -ignore "node_modules,target,dist,build" /path/to/directory
```

## Controls

- **WASD / Arrow Keys**: move
- **Mouse**: look around
- **SPACE**: move up
- **SHIFT+SPACE**: move down
- **SHIFT**: boost
- **P**: navigate to parent
- **C**: navigate to first child
- **[ / ]**: navigate between siblings
- **R**: rename selected file/folder
- **DELETE / BACKSPACE**: delete selected file/folder
- **CLICK**: interact with a node
- **ESC**: unlock mouse
- **Ctrl+F**: focus filesystem search
- **Hover**: inspect file/folder details

## How It Works

```text
REAL FILESYSTEM
      ↓
FILESYSTEM SCANNER
      ↓
HACKERS FILEGRAPH
      ↓
3D FORCE-DIRECTED GRAPH
      ↓
THREE.JS / WEBGL
      ↓
CYBERPUNK 3D WORLD
      ↓
FPS CAMERA
      ↓
INTERACTIVE FILESYSTEM
```

Each filesystem entry becomes a graph node. Parent-child relationships become graph edges. The force simulation clusters related filesystem entries while keeping unrelated nodes separated.

The frontend receives the initial filesystem snapshot from `/api/fs`. A recursive `fsnotify` watcher sends debounced filesystem events through `/api/events`, and the browser reloads the graph when the filesystem changes.

## Reusable 3D Network Scene

HACKERS3D can use the supplied `hackers_network.glb` as a reusable visual template library. The GLB is loaded through Three.js `GLTFLoader` and provides shared file/directory/core assets while filesystem data remains dynamic.

Place the asset at:

```text
static/assets/hackers_network.glb
```

The runtime uses the named templates `FILE_NODE_TEMPLATE`, `DIRECTORY_NODE_TEMPLATE`, `CORE_NODE_TEMPLATE`, `CONNECTION_TEMPLATE`, `PULSE_TEMPLATE` and `NETWORK_CORE`. If the GLB is not present, HACKERS3D keeps the procedural renderer as a fallback.

The supplied scene manifest contains a 321-node visual sample, 58 directories, 1,084 connections, 28 demo pulses and 95 atmosphere points. The sample is a design/template reference; the running application still creates nodes from the real filesystem.

## Current Status

The implementation is complete through the project stages, but runtime validation on a real local machine is still required before calling the build production-ready. In particular, the Go build, browser/WebGL execution, filesystem mutations and large-graph performance need to be exercised on the target computer.

## License

The imported source README states MIT licensing, but the repository does not currently contain a license file in this branch. Verify the license before redistributing the project.
