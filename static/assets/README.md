# HACKERS3D Network Scene Asset

Place the supplied binary scene here as:

`static/assets/hackers_network.glb`

The runtime loads this GLB as a reusable template library, not as a static filesystem snapshot.

Required named objects:

- FILE_NODE_TEMPLATE
- DIRECTORY_NODE_TEMPLATE
- CORE_NODE_TEMPLATE
- CONNECTION_TEMPLATE
- PULSE_TEMPLATE
- NETWORK_CORE

The application falls back to its procedural node renderer if the GLB is absent, so development builds remain runnable before the binary asset is copied into the repository.

Recommended source package:
`hackers_network_package.zip`
