// Global variables
let camera, scene, renderer;
let controls;
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let moveUp = false;
let moveDown = false;
let boost = false;
let prevTime = performance.now();
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let filesystemData;
let hoverInfo = document.getElementById('hover-info');
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let objects = [];
let objectDetails = new Map(); // Store object details for hover info
let highlightedObject = null; // Store currently highlighted object
let highlightedMaterial = null; // Store original material
let objectsById = new Map(); // Store objects by file/folder path for searching
let isFlying = false; // Flag to indicate if camera is automatically flying
let flyingTarget = null; // Target position for automatic flying
let flyingLookAt = null; // Look at position for automatic flying
let searchFocused = false; // Flag to track if search is focused
let selectedObject = null;

function updateTelemetry() {
    const nodeCount = document.getElementById('node-count');
    const boostStatus = document.getElementById('boost-status');
    const flightMode = document.getElementById('flight-mode');
    const currentNodeCount = graphNodes.length || 0;
    if (nodeCount && currentNodeCount !== lastTelemetryNodeCount) {
        nodeCount.textContent = String(currentNodeCount);
        lastTelemetryNodeCount = currentNodeCount;
    }
    if (boostStatus) {
        const nextBoost = boost ? 'ON' : 'OFF';
        if (boostStatus.textContent !== nextBoost) boostStatus.textContent = nextBoost;
    }
    if (flightMode) {
        const nextMode = isFlying ? 'AUTO PILOT' : 'FREE FLIGHT';
        if (flightMode.textContent !== nextMode) flightMode.textContent = nextMode;
    }
}

function updateSelectionPanel(details) {
    const name = document.getElementById('selection-name');
    const info = document.getElementById('selection-details');
    const relations = document.getElementById('selection-relations');
    if (!name || !info) return;
    if (!details) {
        name.textContent = 'NONE';
        info.textContent = 'Click a node to inspect it';
        if (relations) relations.innerHTML = 'PARENT: NONE<br>CHILDREN: 0<br>LINKS: 0';
        return;
    }
    name.textContent = details.name;
    info.innerHTML = [
        '<strong>Type:</strong> ' + details.type,
        '<strong>Path:</strong> ' + details.path,
        details.type === 'File' ? '<strong>Size:</strong> ' + details.size : '<strong>Items:</strong> ' + details.children,
        '<strong>Modified:</strong> ' + details.modified
    ].join('<br>');

    if (relations) {
        const node = graphNodes.find(item => item.id === details.path);
        const parentName = node && node.parentId
            ? (graphNodes.find(item => item.id === node.parentId)?.name || node.parentId)
            : 'NONE';
        const childrenCount = node ? (graphChildrenById.get(node.id) || []).length : 0;
        const linksCount = node ? (graphNeighborsById.get(node.id) || new Set()).size : 0;
        relations.innerHTML =
            'PARENT: ' + parentName +
            '<br>CHILDREN: ' + childrenCount +
            '<br>LINKS: ' + linksCount;
    }
}
let searchInitialized = false;
let highlightedLinkIndices = [];

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return value >= 10 || unitIndex === 0
        ? Math.round(value) + ' ' + units[unitIndex]
        : value.toFixed(1) + ' ' + units[unitIndex];
}

// Initialize the scene
function init() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.0006);

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    // Cap device pixel ratio: 3x/4x mobile and HiDPI displays can otherwise
    // multiply fragment work for no useful gain in a dense 3D graph.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    // Create camera with greater far plane for large grid structures
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 15000);
    camera.position.y = 20;
    camera.position.z = 50;
    
    // Set up PointerLockControls - this will give the proper FPS feel
    controls = new THREE.PointerLockControls(camera, document.body);

    // Click event to request pointer lock or interact with objects
    document.addEventListener('click', function() {
        // If pointer is not locked, lock it
        if (!document.pointerLockElement) {
            controls.lock();
            return;
        }
        
        // If pointer is locked and we have a highlighted object, interact with it
        if (highlightedObject) {
            selectGraphNode(highlightedObject);
            const details = objectDetails.get(highlightedObject.id);
            if (details) {
                if (details.type === 'Directory') {
                    // For directories, open in file explorer
                    openInFileSystem(details.path);
                } else {
                    // For files, open in browser
                    window.open(getUrlForPath(details.path, false), '_blank');
                }
            }
        }
    });

    // Add event listener for pointer lock changes
    document.addEventListener('pointerlockchange', onPointerLockChange);
    
    // Handle Ctrl+F to focus search
    document.addEventListener('keydown', function(e) {
        // Check if Ctrl+F was pressed
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault(); // Prevent browser's default search
            document.getElementById('search-bar').focus();
        }
    });
    
    // Grid removed for cleaner visualization

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0x444444);
    scene.add(ambientLight);

    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(directionalLight);

    // Add controls object to scene
    scene.add(controls.getObject());

    // Set up keyboard controls for WASD movement
    // Store references to event handlers so they can be properly removed
    window.onKeyDownHandler = onKeyDown;
    window.onKeyUpHandler = onKeyUp;
    
    document.addEventListener('keydown', window.onKeyDownHandler);
    document.addEventListener('keyup', window.onKeyUpHandler);

    // Mouse move event for raycasting
    document.addEventListener('mousemove', onMouseMove);

    // Window resize event
    window.addEventListener('resize', onWindowResize);
    
    // Prevent context menu (right click)
    document.addEventListener('contextmenu', function(event) {
        event.preventDefault();
    });

    // Filesystem loading is independent from the optional font resource.
    // Start it after the scene, renderer and controls are fully initialized.
    loadFilesystemData();

    window.addEventListener('blur', clearMovementState);
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) clearMovementState();
    });
}

// Handle pointer lock change
function clearMovementState() {
    moveForward = false;
    moveBackward = false;
    moveLeft = false;
    moveRight = false;
    moveUp = false;
    moveDown = false;
    boost = false;
    velocity.set(0, 0, 0);
}

function onPointerLockChange() {
    const infoPanel = document.getElementById('info');
    
    if (document.pointerLockElement === document.body) {
        document.body.style.cursor = 'none';
        infoPanel.style.opacity = '0.3';
    } else {
        clearMovementState();
        document.body.style.cursor = 'default';
        infoPanel.style.opacity = '1';
    }
}

// Key down event handler
function onKeyDown(event) {
    // If search is focused, don't handle keyboard events for camera controls
    if (searchFocused || document.querySelector('.modal-overlay')) {
        return;
    }
    
    switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
            moveForward = true;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            moveLeft = true;
            break;
        case 'KeyS':
        case 'ArrowDown':
            moveBackward = true;
            break;
        case 'KeyD':
        case 'ArrowRight':
            moveRight = true;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            boost = true;
            break;
        // Space key moves up continuously
        case 'Space':
            // Space moves upward; Shift+Space moves downward.
            if (boost) {
                moveDown = true;
            } else {
                moveUp = true;
            }
            event.preventDefault();
            break;
        case 'KeyP':
            navigateToRelatedNode('parent');
            break;
        case 'BracketLeft':
            navigateSibling(-1);
            break;
        case 'BracketRight':
            navigateSibling(1);
            break;
        case 'KeyC':
            navigateToRelatedNode('child');
            break;
        case 'Escape':
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
            break;
        case 'Delete':
        case 'Backspace': // For Mac users who don't have a dedicated Delete key
            if (highlightedObject) {
                const details = objectDetails.get(highlightedObject.id);
                if (details) {
                    // Temporarily exit pointer lock
                    if (document.pointerLockElement) {
                        document.exitPointerLock();
                    }
                    
                    // Create custom modal for confirming deletion
                    const overlay = document.createElement('div');
                    overlay.className = 'modal-overlay';
                    
                    // Disable camera controls while modal is open
                    moveForward = false;
                    moveBackward = false;
                    moveLeft = false;
                    moveRight = false;
                    moveUp = false;
                    moveDown = false;
                    
                    // Stop any camera movement immediately
                    velocity.set(0, 0, 0);
                    
                    const modal = document.createElement('div');
                    modal.className = 'modal';
                    
                    const header = document.createElement('div');
                    header.className = 'modal-header';
                    header.textContent = `Delete ${details.type}`;
                    
                    const message = document.createElement('div');
                    message.className = 'modal-message';
                    message.innerHTML = `Are you sure you want to delete <strong>${details.name}</strong>?<br><br><span class="warning">This action cannot be undone.</span>`;
                    
                    const buttonsDiv = document.createElement('div');
                    buttonsDiv.className = 'modal-buttons';
                    
                    const cancelBtn = document.createElement('button');
                    cancelBtn.className = 'modal-button modal-cancel';
                    cancelBtn.textContent = 'Cancel';
                    
                    const confirmBtn = document.createElement('button');
                    confirmBtn.className = 'modal-button modal-delete';
                    confirmBtn.textContent = 'Delete';
                    
                    // Assemble modal
                    buttonsDiv.appendChild(cancelBtn);
                    buttonsDiv.appendChild(confirmBtn);
                    
                    modal.appendChild(header);
                    modal.appendChild(message);
                    modal.appendChild(buttonsDiv);
                    
                    overlay.appendChild(modal);
                    document.body.appendChild(overlay);
                    
                    // Prevent clicks on overlay from interacting with the scene
                    overlay.addEventListener('click', function(e) {
                        // Only cancel if clicking directly on overlay (not on modal)
                        if (e.target === overlay) {
                            cancelBtn.click();
                        }
                        e.stopPropagation();
                    });
                    
                    // Return a promise that resolves with the confirmation
                    return new Promise((resolve) => {
                        // Function to remove modal and restore controls
                        const closeModal = () => {
                            document.body.removeChild(overlay);
                            
                            // Only restore keyboard controls if search is not focused
                            if (!document.activeElement || document.activeElement !== document.getElementById('search-bar')) {
                                // Re-enable keyboard event handling for movement
                                document.addEventListener('keydown', window.onKeyDownHandler);
                                document.addEventListener('keyup', window.onKeyUpHandler);
                            }
                        };
                        
                        // Temporarily remove keyboard event listeners to prevent movement
                        document.removeEventListener('keydown', window.onKeyDownHandler);
                        document.removeEventListener('keyup', window.onKeyUpHandler);
                        
                        cancelBtn.addEventListener('click', function() {
                            closeModal();
                            resolve(false); // Don't delete
                        });
                        
                        confirmBtn.addEventListener('click', function() {
                            closeModal();
                            resolve(true); // Confirm delete
                        });
                    }).then(confirmed => {
                        if (confirmed) {
                            // Send delete request to server
                            fetch('/api/delete', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    path: details.path
                                })
                            })
                            .then(response => {
                                if (!response.ok) {
                                    throw new Error('Error deleting file/folder');
                                }
                                return response.json();
                            })
                            .then(data => {
                                console.log('Delete successful:', data);
                                // Reset highlighted object since we're reloading
                                if (highlightedObject && highlightedMaterial) {
                                    highlightedObject.material = highlightedMaterial;
                                    highlightedObject = null;
                                    highlightedMaterial = null;
                                }
                                // Reload filesystem data to update visualization
                                loadFilesystemData();
                            })
                            .catch(error => {
                                console.error('Error deleting:', error);
                                alert('Failed to delete. Check console for details.');
                            });
                        }
                    });
                }
            }
            break;
            
        case 'KeyR':
            if (highlightedObject) {
                const details = objectDetails.get(highlightedObject.id);
                if (details) {
                    // Temporarily exit pointer lock
                    if (document.pointerLockElement) {
                        document.exitPointerLock();
                    }
                    
                    // Create custom modal for renaming
                    const overlay = document.createElement('div');
                    overlay.className = 'modal-overlay';
                    
                    // Disable camera controls while modal is open
                    moveForward = false;
                    moveBackward = false;
                    moveLeft = false;
                    moveRight = false;
                    moveUp = false;
                    moveDown = false;
                    
                    // Stop any camera movement immediately
                    velocity.set(0, 0, 0);
                    
                    const modal = document.createElement('div');
                    modal.className = 'modal';
                    
                    const header = document.createElement('div');
                    header.className = 'modal-header';
                    header.textContent = `Rename ${details.type}`;
                    
                    const input = document.createElement('input');
                    input.className = 'modal-input';
                    input.type = 'text';
                    input.value = details.name;
                    input.select(); // Select all text by default
                    
                    const buttonsDiv = document.createElement('div');
                    buttonsDiv.className = 'modal-buttons';
                    
                    const cancelBtn = document.createElement('button');
                    cancelBtn.className = 'modal-button modal-cancel';
                    cancelBtn.textContent = 'Cancel';
                    
                    const confirmBtn = document.createElement('button');
                    confirmBtn.className = 'modal-button modal-confirm';
                    confirmBtn.textContent = 'Rename';
                    
                    // Assemble modal
                    buttonsDiv.appendChild(cancelBtn);
                    buttonsDiv.appendChild(confirmBtn);
                    
                    modal.appendChild(header);
                    modal.appendChild(input);
                    modal.appendChild(buttonsDiv);
                    
                    overlay.appendChild(modal);
                    document.body.appendChild(overlay);
                    
                    // Prevent clicks on overlay from interacting with the scene
                    overlay.addEventListener('click', function(e) {
                        // Only cancel if clicking directly on overlay (not on modal)
                        if (e.target === overlay) {
                            cancelBtn.click();
                        }
                        e.stopPropagation();
                    });
                    
                    // Focus input after modal is added to DOM
                    setTimeout(() => input.focus(), 0);
                    
                    // Handle input events - need a separate event handler
                    // that doesn't trigger the main keyboard controls
                    const handleInputKeys = function(e) {
                        // Prevent event propagation to avoid triggering movement
                        e.stopPropagation();
                        
                        if (e.key === 'Enter') {
                            confirmBtn.click();
                        } else if (e.key === 'Escape') {
                            cancelBtn.click();
                        }
                    };
                    
                    // Add the event listener directly to the input element
                    input.addEventListener('keydown', handleInputKeys);
                    
                    // Return a promise that resolves with the new name
                    return new Promise((resolve) => {
                        // Function to remove modal and restore controls
                        const closeModal = () => {
                            document.body.removeChild(overlay);
                            
                            // Remove the input's keydown listener
                            input.removeEventListener('keydown', handleInputKeys);
                            
                            // Only restore keyboard controls if search is not focused
                            if (!document.activeElement || document.activeElement !== document.getElementById('search-bar')) {
                                // Re-enable keyboard event handling for movement
                                document.addEventListener('keydown', window.onKeyDownHandler);
                                document.addEventListener('keyup', window.onKeyUpHandler);
                            }
                        };
                        
                        // Temporarily remove keyboard event listeners to prevent movement
                        document.removeEventListener('keydown', window.onKeyDownHandler);
                        document.removeEventListener('keyup', window.onKeyUpHandler);
                        
                        cancelBtn.addEventListener('click', function() {
                            closeModal();
                            resolve(null); // Null indicates cancel
                        });
                        
                        confirmBtn.addEventListener('click', function() {
                            const newName = input.value.trim();
                            closeModal();
                            resolve(newName.length > 0 ? newName : null);
                        });
                    }).then(newName => {
                        // If user provided a new name, send to server
                        if (newName && newName !== details.name) {
                            fetch('/api/rename', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    path: details.path,
                                    newName: newName
                                })
                            })
                            .then(response => {
                                if (!response.ok) {
                                    throw new Error('Error renaming file/folder');
                                }
                                return response.json();
                            })
                            .then(data => {
                                console.log('Rename successful:', data);
                                // Reset highlighted object since we're reloading
                                if (highlightedObject && highlightedMaterial) {
                                    highlightedObject.material = highlightedMaterial;
                                    highlightedObject = null;
                                    highlightedMaterial = null;
                                }
                                // Reload filesystem data to update visualization
                                loadFilesystemData();
                            })
                            .catch(error => {
                                console.error('Error renaming:', error);
                                alert('Failed to rename. Check console for details.');
                            });
                        }
                    });
                }
            }
            break;
    }
}

// Key up event handler
function onKeyUp(event) {
    // If search is focused, don't handle keyboard events for camera controls
    if (searchFocused || document.querySelector('.modal-overlay')) {
        return;
    }
    
    switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
            moveForward = false;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            moveLeft = false;
            break;
        case 'KeyS':
        case 'ArrowDown':
            moveBackward = false;
            break;
        case 'KeyD':
        case 'ArrowRight':
            moveRight = false;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            boost = false;
            moveDown = false;
            break;
        case 'Space':
            moveUp = false;
            moveDown = false;
            break;
    }
}

function onMouseMove(event) {
    // Calculate mouse position in normalized device coordinates
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function loadFilesystemData() {
    if (filesystemReloadInProgress) {
        filesystemReloadQueued = true;
        return Promise.resolve();
    }
    filesystemReloadInProgress = true;
    filesystemReloadQueued = false;

    if (forceSimulation) {
        forceSimulation.stop();
        forceSimulation = null;
    }

    // Preserve the FPS camera object, but dispose every previous visualization object
    // exactly once. Reloads happen after rename/delete, so cleanup needs to be boringly reliable.
    const preserved = controls.getObject();
    const previousChildren = scene.children.slice();

    for (const child of previousChildren) {
        if (child === preserved) continue;
        scene.remove(child);
        disposeObject(child);
    }

    // Shared node materials survive normal mesh cleanup and are reused on the
    // next graph load. They remain alive for the lifetime of the renderer.
    objects = [];
    objectDetails = new Map();
    objectsById = new Map();
    graphNodes = [];
    graphLinks = [];
    graphNodesById = new Map();
    graphLine = null;
    graphLineGeometry = null;
    graphLinePositions = null;
    
    // Re-add the camera and fresh scene lighting.
    scene.add(preserved);
    
    const ambientLight = new THREE.AmbientLight(0x444444);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(directionalLight);
    
    fetch('/api/fs')
        .then(response => {
            if (!response.ok) {
                throw new Error('Filesystem API returned HTTP ' + response.status);
            }
            return response.json();
        })
        .then(data => {
            console.log('Filesystem data loaded:', data);
            filesystemData = data;
            createVisualization(filesystemData);
            initSearch();
        })
        .catch(error => console.error('Error loading filesystem data:', error))
        .finally(() => {
            filesystemReloadInProgress = false;
            if (filesystemReloadQueued) {
                filesystemReloadQueued = false;
                loadFilesystemData();
            }
        });
}

let forceSimulation = null;
let graphNodes = [];
let graphLinks = [];
let graphNodesById = new Map();
let graphChildrenById = new Map();
let graphNeighborsById = new Map();
let graphEdgeIndicesByNodeId = new Map();
let graphLine = null;
let graphLinePositions = null;
let graphLineGeometry = null;
let frameCounter = 0;
let lastTelemetryNodeCount = -1;
let lastCullCameraPosition = new THREE.Vector3();
let performanceNodeThreshold = 2500;
let graphLinkUpdateStride = 1;
let forceTickCounter = 0;

const sharedNodeMaterials = {
    directory: new THREE.MeshStandardMaterial({
        color: 0x00ff66,
        emissive: 0x003d1a,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.72,
        roughness: 0.35,
        metalness: 0.15
    }),
    file: new THREE.MeshStandardMaterial({
        color: 0x00ffaa,
        emissive: 0x002b1c,
        emissiveIntensity: 0.9,
        roughness: 0.4,
        metalness: 0.2
    })
};

function disposeObject(object) {
    if (!object) return;
    if (object.geometry) object.geometry.dispose();
    // Node materials are shared across the graph. Dispose them only through the
    // dedicated shared-material lifecycle, not once per mesh during reload.
    if (object.material && object.material !== sharedNodeMaterials.directory &&
        object.material !== sharedNodeMaterials.file) {
        if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
        else object.material.dispose();
    }
}

function flattenFilesystemTree(root) {
    const nodes = [];
    const links = [];
    const byPath = new Map();

    function walk(node, parentPath) {
        if (!node || !node.path) return;

        const id = node.path;
        const graphNode = {
            id,
            name: node.name || id.split('/').pop() || id,
            path: node.path,
            isDir: !!node.isDir,
            size: Number(node.size) || 0,
            modified: node.modified || '',
            childrenCount: Array.isArray(node.children) ? node.children.length : 0,
            parentId: parentPath || null
        };

        nodes.push(graphNode);
        byPath.set(id, graphNode);

        if (parentPath) {
            links.push({ source: parentPath, target: id });
        }

        if (Array.isArray(node.children)) {
            for (const child of node.children) {
                walk(child, id);
            }
        }
    }

    walk(root, null);

    // Build adjacency once. Navigation and highlighting should not scan the full
    // filesystem graph every time the user presses a key. Humans already do enough
    // unnecessary work; the browser needn't join them.
    const childrenById = new Map();
    const neighborsById = new Map();
    const edgeIndicesByNodeId = new Map();
    for (const node of nodes) {
        childrenById.set(node.id, []);
        neighborsById.set(node.id, new Set());
        edgeIndicesByNodeId.set(node.id, []);
    }
    for (let i = 0; i < links.length; i++) {
        const link = links[i];
        if (!childrenById.has(link.source)) childrenById.set(link.source, []);
        childrenById.get(link.source).push(link.target);
        if (!neighborsById.has(link.source)) neighborsById.set(link.source, new Set());
        if (!neighborsById.has(link.target)) neighborsById.set(link.target, new Set());
        neighborsById.get(link.source).add(link.target);
        neighborsById.get(link.target).add(link.source);
        edgeIndicesByNodeId.get(link.source)?.push(i);
        edgeIndicesByNodeId.get(link.target)?.push(i);
    }

    return { nodes, links, byPath, childrenById, neighborsById, edgeIndicesByNodeId };
}

function createGraphNode(node) {
    const radius = node.isDir
        ? Math.min(7, 2.8 + Math.log2(node.childrenCount + 1) * 0.9)
        : Math.min(4.5, 1.6 + Math.log2(node.size + 1) * 0.12);

    const graphSize = graphNodes.length || 0;
    const geometry = node.isDir
        ? new THREE.SphereGeometry(
            radius,
            graphSize > 10000 ? 6 : graphSize > 2500 ? 8 : 16,
            graphSize > 10000 ? 4 : graphSize > 2500 ? 6 : 12
        )
        : new THREE.SphereGeometry(
            radius,
            graphSize > 10000 ? 5 : graphSize > 2500 ? 6 : 12,
            graphSize > 10000 ? 3 : graphSize > 2500 ? 4 : 8
        );

    const material = node.isDir
        ? sharedNodeMaterials.directory
        : sharedNodeMaterials.file;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.graphNodeId = node.id;
    mesh.userData.path = node.path;

    objects.push(mesh);
    objectDetails.set(mesh.id, {
        name: node.name,
        path: node.path,
        type: node.isDir ? 'Directory' : 'File',
        size: formatFileSize(node.size),
        modified: node.modified,
        children: node.childrenCount
    });
    objectsById.set(node.path, {
        object: mesh,
        type: node.isDir ? 'Directory' : 'File'
    });

    return mesh;
}

function createGraphLinks() {
    if (!graphLinks.length) return;

    graphLinePositions = new Float32Array(graphLinks.length * 6);
    graphLineGeometry = new THREE.BufferGeometry();
    graphLineGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(graphLinePositions, 3)
    );

    const colors = new Float32Array(graphLinks.length * 6);
    for (let i = 0; i < colors.length; i += 3) {
        colors[i] = 0;
        colors[i + 1] = 1;
        colors[i + 2] = 0.4;
    }
    graphLineGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.38
    });

    graphLine = new THREE.LineSegments(graphLineGeometry, material);
    graphLine.frustumCulled = false;
    scene.add(graphLine);
}

function updateGraphLinks() {
    if (!graphLine || !graphLinePositions) return;

    for (let i = 0; i < graphLinks.length; i++) {
        const link = graphLinks[i];
        const source = link.source;
        const target = link.target;
        const sMesh = source.mesh;
        const tMesh = target.mesh;
        const offset = i * 6;

        graphLinePositions[offset] = sMesh.position.x;
        graphLinePositions[offset + 1] = sMesh.position.y;
        graphLinePositions[offset + 2] = sMesh.position.z;
        graphLinePositions[offset + 3] = tMesh.position.x;
        graphLinePositions[offset + 4] = tMesh.position.y;
        graphLinePositions[offset + 5] = tMesh.position.z;
    }

    graphLineGeometry.attributes.position.needsUpdate = true;
}

function directoryClusterForce(strength = 0.045) {
    let nodes = [];

    function force(alpha) {
        const k = strength * alpha;
        for (const node of nodes) {
            if (!node.parentId || !node.parentNode) continue;

            const parent = node.parentNode;
            const dx = (parent.x || 0) - (node.x || 0);
            const dy = (parent.y || 0) - (node.y || 0);
            const dz = (parent.z || 0) - (node.z || 0);

            node.vx += dx * k;
            node.vy += dy * k;
            node.vz += dz * k;
        }
    }

    force.initialize = function(initializedNodes) {
        nodes = initializedNodes;
    };

    return force;
}

function positionCameraForGraph(nodeCount) {
    const graphRadius = Math.max(80, Math.min(1100, Math.cbrt(Math.max(1, nodeCount)) * 40));
    const cameraObject = controls.getObject();

    cameraObject.position.set(0, Math.max(12, graphRadius * 0.055), graphRadius);
    cameraObject.rotation.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
}

function createVisualization(root) {
    const flattened = flattenFilesystemTree(root);
    graphNodes = flattened.nodes;
    graphLinks = flattened.links;
    graphNodesById = new Map(graphNodes.map(node => [node.id, node]));
    graphChildrenById = flattened.childrenById;
    graphNeighborsById = flattened.neighborsById;
    graphEdgeIndicesByNodeId = flattened.edgeIndicesByNodeId;

    const graphById = graphNodesById;

    // Build explicit parent references so directory clusters stay spatially coherent.
    for (const node of graphNodes) {
        node.parentNode = node.parentId ? graphById.get(node.parentId) : null;
    }

    // HACKERS spatial layout: keep the filesystem readable while preserving the
    // huge 3D network feel. Directories occupy the large-scale volume; files orbit
    // their parent directory instead of becoming an undifferentiated cloud.
    const childrenByParent = new Map();
    for (const node of graphNodes) {
        if (!node.parentId) continue;
        if (!childrenByParent.has(node.parentId)) childrenByParent.set(node.parentId, []);
        childrenByParent.get(node.parentId).push(node);
    }

    const depthById = new Map();
    const rootNode = graphNodes.find(node => !node.parentId);
    if (rootNode) {
        depthById.set(rootNode.id, 0);
        const queue = [rootNode];
        while (queue.length) {
            const parent = queue.shift();
            for (const child of childrenByParent.get(parent.id) || []) {
                depthById.set(child.id, (depthById.get(parent.id) || 0) + 1);
                queue.push(child);
            }
        }
    }

    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const directories = graphNodes.filter(node => node.isDir && node !== rootNode);
    const rootChildren = rootNode ? (childrenByParent.get(rootNode.id) || []) : [];
    const rootDirs = rootChildren.filter(node => node.isDir);

    if (rootNode) {
        rootNode.x = 0;
        rootNode.y = 0;
        rootNode.z = 0;
        rootNode.vx = 0;
        rootNode.vy = 0;
        rootNode.vz = 0;
    }

    // Large directory clusters form the skeleton of the world.
    for (let i = 0; i < directories.length; i++) {
        const dir = directories[i];
        const parent = dir.parentId ? graphNodesById.get(dir.parentId) : null;
        if (parent && parent !== rootNode) continue;

        const angle = i * goldenAngle;
        const radius = Math.max(105, Math.min(500, 105 + Math.sqrt(Math.max(1, rootDirs.length)) * 42));
        dir.x = Math.cos(angle) * radius;
        dir.y = Math.sin(angle * 1.37) * radius * 0.48;
        dir.z = Math.sin(angle) * radius;
        dir.vx = 0;
        dir.vy = 0;
        dir.vz = 0;
    }

    // Deeper directories inherit their parent's position and form smaller satellites.
    for (let pass = 0; pass < 6; pass++) {
        for (const dir of directories) {
            if (dir.x !== undefined && dir.parentId === (rootNode && rootNode.id)) continue;
            const parent = dir.parentId ? graphNodesById.get(dir.parentId) : null;
            if (!parent || parent.x === undefined) continue;
            const siblings = (childrenByParent.get(parent.id) || []).filter(node => node.isDir);
            const index = Math.max(0, siblings.indexOf(dir));
            const angle = index * goldenAngle + pass * 0.13;
            const radius = Math.max(38, Math.min(150, 42 + Math.sqrt(Math.max(1, siblings.length)) * 14));
            dir.x = (parent.x || 0) + Math.cos(angle) * radius;
            dir.y = (parent.y || 0) + Math.sin(angle * 1.51) * radius * 0.58;
            dir.z = (parent.z || 0) + Math.sin(angle) * radius;
            dir.vx = 0;
            dir.vy = 0;
            dir.vz = 0;
        }
    }

    // Files orbit their immediate directory. Larger folders get a wider local cloud.
    for (const parent of graphNodes.filter(node => node.isDir)) {
        const children = childrenByParent.get(parent.id) || [];
        const files = children.filter(node => !node.isDir);
        const radius = Math.max(24, Math.min(105, 24 + Math.sqrt(Math.max(1, files.length)) * 9));

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const angle = i * goldenAngle;
            const localRadius = radius * (0.65 + Math.sqrt((i + 1) / Math.max(1, files.length)) * 0.72);
            file.x = (parent.x || 0) + Math.cos(angle) * localRadius;
            file.y = (parent.y || 0) + Math.sin(angle * 1.71) * localRadius * 0.62;
            file.z = (parent.z || 0) + Math.sin(angle) * localRadius;
            file.vx = 0;
            file.vy = 0;
            file.vz = 0;
        }
    }

    for (const node of graphNodes) {
        node.mesh = createGraphNode(node);
    }

    for (const link of graphLinks) {
        link.source = graphById.get(link.source);
        link.target = graphById.get(link.target);
    }

    createGraphLinks();

    // Particle field inspired by the data-flow reference. It stays behind the
    // filesystem graph and is deliberately sparse so the nodes remain readable.
    const particleCount = Math.min(1400, Math.max(220, Math.floor(Math.sqrt(Math.max(1, graphNodes.length)) * 16)));
    const particlePositions = new Float32Array(particleCount * 3);
    const particleSpread = Math.max(220, Math.min(950, Math.cbrt(Math.max(1, graphNodes.length)) * 62));
    for (let i = 0; i < particleCount; i++) {
        const r = particleSpread * Math.cbrt((i + 1) / particleCount);
        const theta = i * goldenAngle * 1.7;
        const phi = Math.acos(1 - 2 * ((i + 0.5) / particleCount));
        particlePositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        particlePositions[i * 3 + 1] = r * Math.cos(phi);
        particlePositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({
        color: 0x00ff66,
        size: 1.1,
        transparent: true,
        opacity: 0.28,
        depthWrite: false
    });
    const particleField = new THREE.Points(particleGeometry, particleMaterial);
    particleField.name = 'hackers-data-field';
    particleField.frustumCulled = false;
    scene.add(particleField);

    if (forceSimulation) forceSimulation.stop();

    const nodeCount = graphNodes.length;
    const forceQuality = nodeCount > 12000 ? 0.55 : nodeCount > 5000 ? 0.7 : 1;
    // Link geometry is CPU-updated from the force simulation. For large graphs,
    // updating every physics tick wastes work that the renderer cannot meaningfully
    // present at full simulation frequency.
    graphLinkUpdateStride = nodeCount > 12000 ? 4 : nodeCount > 5000 ? 3 : nodeCount > 2500 ? 2 : 1;
    forceTickCounter = 0;

    forceSimulation = d3.forceSimulation(graphNodes, 3)
        .force('link', d3.forceLink(graphLinks).id(d => d.id).distance(link => {
            const parent = link.source;
            return parent && parent.isDir ? 48 : 36;
        }).strength(0.68 * forceQuality))
        .force('cluster', directoryClusterForce(0.11 * forceQuality))
        .force('layout', filesystemLayoutForce(0.13 * forceQuality))
        .force('charge', d3.forceManyBody().strength(d => (d.isDir ? -125 : -48) * forceQuality).distanceMax(900))
        .force('center', d3.forceCenter(0, 0, 0).strength(0.018 * forceQuality))
        .force('collision', d3.forceCollide().radius(d => d.isDir ? 10 : 5.5).strength(0.62 * forceQuality))
        .alphaDecay(nodeCount > 5000 ? 0.035 : 0.02)
        .velocityDecay(0.4);

    // Keep the physics bounded. Very large real filesystems should degrade gracefully
    // instead of turning the browser into a space heater.
    if (nodeCount > 12000) {
        forceSimulation.alphaMin(0.08);
    }

    forceSimulation.on('tick', () => {
        forceTickCounter++;
        for (const node of graphNodes) {
            node.mesh.position.x = node.x || 0;
            node.mesh.position.y = node.y || 0;
            node.mesh.position.z = node.z || 0;
        }
        if (forceTickCounter % graphLinkUpdateStride === 0) {
            updateGraphLinks();
        }
    });

    forceSimulation.on('end', () => {
        // Always publish the final settled positions even when the stride skipped
        // the last few ticks.
        updateGraphLinks();
    });

    positionCameraForGraph(graphNodes.length);

    console.log('HACKERS3D graph:', {
        nodes: graphNodes.length,
        links: graphLinks.length
    });
}

function selectGraphNode(object) {
    if (!object) return;
    const details = objectDetails.get(object.id);
    if (!details) return;

    selectedObject = object;
    highlightedObject = object;
    updateSelectionPanel(details);
    updateLinkHighlight();
}

function getSelectedGraphNode() {
    if (!selectedObject || !selectedObject.userData) return null;
    const id = selectedObject.userData.graphNodeId;
    return graphNodes.find(node => node.id === id) || null;
}

function getSelectedRelatedNodes() {
    const node = getSelectedGraphNode();
    if (!node) return { parent: null, children: [], neighbors: [] };

    const childIds = graphChildrenById.get(node.id) || [];
    const neighborIds = graphNeighborsById.get(node.id) || new Set();
    return {
        parent: node.parentId ? graphNodesById.get(node.parentId) || null : null,
        children: childIds.map(id => graphNodesById.get(id)).filter(Boolean),
        neighbors: Array.from(neighborIds).map(id => graphNodesById.get(id)).filter(Boolean)
    };
}

function navigateSibling(offset) {
    const node = getSelectedGraphNode();
    if (!node || !node.parentId) return;

    const siblings = graphChildrenById.get(node.parentId) || [];
    const index = siblings.indexOf(node.id);
    if (index < 0 || siblings.length < 2) return;

    const nextIndex = (index + offset + siblings.length) % siblings.length;
    const targetId = siblings[nextIndex];
    const targetObject = objects.find(object =>
        object.userData && object.userData.graphNodeId === targetId
    );
    if (!targetObject) return;

    selectGraphNode(targetObject);
    flyToObject(targetId);
}

function navigateToRelatedNode(direction) {
    if (!highlightedObject || !highlightedObject.userData.graphNodeId) return;
    const currentId = highlightedObject.userData.graphNodeId;
    const currentNode = graphNodes.find(node => node.id === currentId);
    if (!currentNode) return;

    let target = null;
    if (direction === 'parent' && currentNode.parentId) {
        target = graphNodesById.get(currentNode.parentId) || null;
    } else if (direction === 'child') {
        const children = graphChildrenById.get(currentId) || [];
        target = graphNodesById.get(children[0]) || null;
    }
    if (!target) return;

    const targetObject = objects.find(object =>
        object.userData && object.userData.graphNodeId === target.id
    );
    if (!targetObject) return;

    selectGraphNode(targetObject);
    flyToObject(target.path);
}

function updateLinkHighlight() {
    if (!graphLine || !graphLine.geometry || !graphLine.geometry.attributes.color) return;
    const colors = graphLine.geometry.attributes.color.array;

    // Restore only links that were highlighted during the previous selection.
    // For large graphs this avoids scanning every edge just to reset green.
    for (const index of highlightedLinkIndices) {
        const offset = index * 6;
        for (let i = 0; i < 6; i += 3) {
            colors[offset + i] = 0;
            colors[offset + i + 1] = 1;
            colors[offset + i + 2] = 0.4;
        }
    }

    highlightedLinkIndices = [];
    if (!highlightedObject) {
        graphLine.geometry.attributes.color.needsUpdate = true;
        return;
    }

    const selectedId = highlightedObject.userData.graphNodeId;
    const neighborIds = graphNeighborsById.get(selectedId) || new Set();

    // Use the indexed neighbor set to identify the selected node's direct
    // relationships. Then map those neighbors to edge indices once per graph.
    // This removes the O(E) scan from every render frame.
    const edgeIndicesByNodeId = graphEdgeIndicesByNodeId;
    const selectedEdges = edgeIndicesByNodeId.get(selectedId) || [];

    for (const i of selectedEdges) {
        const offset = i * 6;
        highlightedLinkIndices.push(i);
        for (let j = 0; j < 6; j += 3) {
            colors[offset + j] = 1;
            colors[offset + j + 1] = 1;
            colors[offset + j + 2] = 1;
        }
    }

    highlightedObject.userData.neighborCount = neighborIds.size;
    graphLine.geometry.attributes.color.needsUpdate = true;
}

let lastIntersectionFrame = -10;
let filesystemEventSource = null;
let filesystemConnectionState = 'CONNECTING';
let filesystemReloadInProgress = false;
let filesystemReloadQueued = false;

function checkIntersections() {
    // Large graphs do not need a full raycast on every rendered frame.
    if (graphNodes.length > performanceNodeThreshold && frameCounter - lastIntersectionFrame < 3) {
        return;
    }
    lastIntersectionFrame = frameCounter;

    // Update the raycaster with the current camera and mouse position
    raycaster.setFromCamera(mouse, camera);
    
    // Calculate objects intersecting the ray
    const intersects = raycaster.intersectObjects(objects);
    
    // Reset cursor
    if (!document.pointerLockElement) {
        document.body.style.cursor = 'default';
    }
    
    // Reset crosshair
    const crosshair = document.getElementById('crosshair');
    crosshair.classList.remove('active');
    
    const nextObject = intersects.length > 0 ? intersects[0].object : null;
    const nextDetails = nextObject ? objectDetails.get(nextObject.id) : null;

    // Only rebuild materials when the hovered node actually changes.
    // Replacing/cloning a material every animation frame creates needless GC pressure.
    if (nextObject !== highlightedObject) {
        if (highlightedObject && highlightedMaterial) {
            highlightedObject.material = highlightedMaterial;
        }

        highlightedObject = null;
        highlightedMaterial = null;

        if (nextObject && nextDetails) {
            highlightedObject = nextObject;
            highlightedMaterial = nextObject.material;

            const highlightMaterial = nextObject.material.clone();
            if (highlightMaterial.color) {
                highlightMaterial.emissive = new THREE.Color(0xffff00);
                highlightMaterial.emissiveIntensity = 0.3;
            }
            nextObject.material = highlightMaterial;
        }
    }

    if (nextObject && nextDetails) {
        const object = nextObject;
        const details = nextDetails;
            // Get file extension and type info for Files
            let fileType = '';
            if (details.type === 'File') {
                const extension = details.name.split('.').pop().toLowerCase();
                fileType = getFileType(extension);
            }
            
            // Update hover info
            let info = `<strong>${details.name}</strong>`;
            info += `<br><span style="color: #aaffaa;">${details.type}</span>`;
            
            if (details.type === 'File') {
                info += `<br><span style="color: #aaaaff;">Type:</span> ${fileType}`;
                info += `<br><span style="color: #aaaaff;">Size:</span> ${details.size}`;
            } else {
                info += `<br><span style="color: #aaaaff;">Items:</span> ${details.children}`;
            }
            
            info += `<br><span style="color: #aaaaff;">Path:</span> ${details.path}`;
            info += `<br><span style="color: #aaaaff;">Modified:</span> ${details.modified}`;
            
            if (details.type === 'Directory') {
                info += `<br><span style="color: #ffff99; font-weight: bold;">Click to open in file explorer</span>`;
            } else {
                info += `<br><span style="color: #ffff99; font-weight: bold;">Click to open in new tab</span>`;
            }
            
            hoverInfo.innerHTML = info;
            updateSelectionPanel(nextDetails);
            if (!document.pointerLockElement) {
                document.body.style.cursor = 'pointer';
            }
            
            // Update crosshair
            crosshair.classList.add('active');
    } else {
        // No intersection, show default text
        hoverInfo.innerHTML = 'Hover over an object to see details';
    }
}

// Helper function to get URL for a path
function getUrlForPath(path, isDirectory) {
    // Use our server API to handle files
    return '/api/open?path=' + encodeURIComponent(path);
}

// Function to open directory in the file system
function openInFileSystem(path) {
    fetch('/api/open-directory?path=' + encodeURIComponent(path), {
        method: 'POST'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Error opening directory');
        }
        return response.text();
    })
    .then(data => {
        console.log('Directory opened:', data);
    })
    .catch(error => {
        console.error('Error opening directory:', error);
        alert('Failed to open directory. This may be due to security restrictions or the directory not being accessible.');
    });
}

function updateLargeGraphCulling() {
    if (graphNodes.length < performanceNodeThreshold) return;

    const cameraPosition = controls.getObject().position;
    if (cameraPosition.distanceToSquared(lastCullCameraPosition) < 16) return;
    lastCullCameraPosition.copy(cameraPosition);

    const maxDistance = Math.max(260, Math.min(900, Math.cbrt(graphNodes.length) * 120));
    const maxDistanceSq = maxDistance * maxDistance;

    for (const node of graphNodes) {
        if (!node.mesh) continue;
        const dx = (node.x || 0) - cameraPosition.x;
        const dy = (node.y || 0) - cameraPosition.y;
        const dz = (node.z || 0) - cameraPosition.z;
        const visible = dx * dx + dy * dy + dz * dz <= maxDistanceSq;
        node.mesh.visible = visible;
    }

    if (graphLine) graphLine.visible = true;
}

function animate() {
    requestAnimationFrame(animate);
    
    frameCounter++;
    if ((frameCounter & 15) === 0) updateLargeGraphCulling();

    // Update movement - this is the FPS game-like motion
    const time = performance.now();
    const delta = Math.min(0.1, (time - prevTime) / 1000); // Cap delta to prevent jumps
    
    if (isFlying && flyingTarget) {
        // Automatic flying to target object
        const cameraPosition = controls.getObject().position;
        const distanceToTarget = cameraPosition.distanceTo(flyingTarget);
        
        if (distanceToTarget > 5) { // Continue flying until we're close enough
            // Calculate direction to target
            const flyDirection = new THREE.Vector3().subVectors(flyingTarget, cameraPosition).normalize();
            
            // Calculate speed based on distance (slow down when approaching)
            const flySpeed = Math.min(500, Math.max(50, distanceToTarget * 30));
            
            // Move camera towards target
            controls.getObject().position.add(flyDirection.multiplyScalar(flySpeed * delta));
            
            // Gradually look at the target while flying
            if (flyingLookAt) {
                // Calculate current camera direction
                const currentDirection = new THREE.Vector3();
                camera.getWorldDirection(currentDirection);
                
                // Calculate target direction
                const targetDirection = new THREE.Vector3().subVectors(flyingLookAt, cameraPosition).normalize();
                
                // Interpolate between current and target direction
                const lerpFactor = 0.05; // Adjust for smoother rotation
                const newDirection = currentDirection.lerp(targetDirection, lerpFactor);
                
                // Create a quaternion from the interpolated direction
                const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(
                    new THREE.Vector3(0, 0, -1), // Camera forward direction
                    newDirection
                );
                
                // Apply rotation to camera
                camera.quaternion.slerp(targetQuaternion, 0.1);
            }
        } else {
            // We've reached the target, stop flying
            isFlying = false;
            flyingTarget = null;
            flyingLookAt = null;
        }
    } else {
        // Normal manual movement
        // Apply reduced friction to allow higher speeds
        velocity.x -= velocity.x * 2.0 * delta; // Less friction for faster acceleration
        velocity.z -= velocity.z * 2.0 * delta;
        velocity.y -= velocity.y * 2.0 * delta; // Apply same friction to vertical movement for consistent flying
        
        // Skip movement processing if search is focused or a modal is open
        if (!searchFocused && !document.querySelector('.modal-overlay')) {
            // Get camera's forward direction vector
            const cameraDirection = new THREE.Vector3();
            camera.getWorldDirection(cameraDirection);
            
            // Create a forward vector that preserves the camera's horizontal direction but doesn't go up/down
            // when moving forward/backward
            const forwardDirection = new THREE.Vector3(
                cameraDirection.x,
                0,
                cameraDirection.z
            ).normalize();
            
            // The up/down component is only used when looking steeply up or down
            const verticalComponent = new THREE.Vector3(
                0,
                cameraDirection.y,
                0
            );
            
            // Create movement direction based on camera's orientation and key presses
            direction.set(0, 0, 0);
            
            if (moveForward) {
                // When looking level, move horizontally
                direction.add(forwardDirection);
                // When looking steeply up/down, add vertical movement
                if (Math.abs(cameraDirection.y) > 0.5) {
                    direction.add(verticalComponent);
                }
            }
            if (moveBackward) {
                // Move in the opposite direction
                direction.sub(forwardDirection);
                // When looking steeply up/down, add inverted vertical movement
                if (Math.abs(cameraDirection.y) > 0.5) {
                    direction.sub(verticalComponent);
                }
            }
            
            // For sideways movement, calculate the right vector by crossing the camera direction with world up
            // This ensures correct right/left movement regardless of camera orientation
            const worldUp = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3();
            right.crossVectors(cameraDirection, worldUp).normalize();
            
            if (moveRight) {
                direction.add(right);
            }
            if (moveLeft) {
                direction.sub(right);
            }
            
            // Add direct up/down movement with Space and Shift+Space
            if (moveUp) {
                direction.y += 1.0;
            }
            if (moveDown) {
                direction.y -= 1.0;
            }
            
            // Normalize for consistent speed in all directions
            if (direction.length() > 0) {
                direction.normalize();
            }
            
            // For the grid-based visualization, we need much faster movement speed 
            // to navigate the potentially very large structures
            const speedFactor = boost ? 700 : 100; // 7x faster than before
            
            // Apply movement force in all dimensions
            velocity.x += direction.x * speedFactor * delta;
            velocity.z += direction.z * speedFactor * delta;
            // Allow vertical movement based on where the camera is pointing
            velocity.y += direction.y * speedFactor * delta;
        }
        
        // Calculate movement in world space
        const movement = new THREE.Vector3(
            velocity.x * delta,
            velocity.y * delta,
            velocity.z * delta
        );
        
        // Apply movement directly to the camera's position
        controls.getObject().position.add(movement);
    }
    
    prevTime = time;
    
    // Check for intersections for hover info
    checkIntersections();
    updateTelemetry();
    
    // Update graph link highlighting after raycasting.
    updateLinkHighlight();

    // Render scene
    renderer.render(scene, camera);
}

// Search functionality
function initSearch() {
    if (searchInitialized) return;
    searchInitialized = true;

    const searchBar = document.getElementById('search-bar');
    const searchResults = document.getElementById('search-results');
    
    // Listen for input on search bar
    searchBar.addEventListener('input', function(e) {
        const query = e.target.value.trim().toLowerCase();
        
        // Clear previous results
        searchResults.innerHTML = '';
        
        if (query.length < 2) {
            searchResults.style.display = 'none';
            return;
        }
        
        // Search through objects by name
        const results = [];
        for (const [path, details] of objectsById.entries()) {
            // Get the name from the path (last segment)
            const name = path.split('/').pop();
            
            if (name.toLowerCase().includes(query)) {
                results.push({
                    name: name,
                    path: path,
                    type: details.type
                });
            }
        }
        
        // Sort results: directories first, then alphabetically
        results.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'Directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        
        // Display results
        if (results.length > 0) {
            results.slice(0, 10).forEach(result => {
                const resultElement = document.createElement('div');
                resultElement.className = `search-result ${result.type.toLowerCase()}`;
                
                // Highlight the matching text
                const highlightedName = result.name.replace(
                    new RegExp(`(${query})`, 'gi'),
                    '<span class="highlight">$1</span>'
                );
                
                resultElement.innerHTML = `
                    <div>${highlightedName}</div>
                    <div class="path">${result.path}</div>
                `;
                
                // Add click event to navigate to the object
                resultElement.addEventListener('click', function() {
                    flyToObject(result.path);
                    // Return focus to the 3D view after clicking a result
                    searchBar.blur();
                });
                
                searchResults.appendChild(resultElement);
            });
            
            if (results.length > 10) {
                const moreResults = document.createElement('div');
                moreResults.className = 'search-result';
                moreResults.innerHTML = `<div>${results.length - 10} more results...</div>`;
                searchResults.appendChild(moreResults);
            }
            
            searchResults.style.display = 'block';
        } else {
            const noResults = document.createElement('div');
            noResults.className = 'no-results';
            noResults.textContent = 'No results found';
            searchResults.appendChild(noResults);
            searchResults.style.display = 'block';
        }
    });
    
    // Close search results when clicking outside
    document.addEventListener('click', function(e) {
        if (!searchBar.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.style.display = 'none';
            
            // If search bar is focused and we click elsewhere, blur it to restore controls
            if (document.activeElement === searchBar) {
                searchBar.blur();
            }
        }
    });
    
    // Prevent clicks on search results from propagating (to avoid triggering camera controls)
    searchResults.addEventListener('click', function(e) {
        e.stopPropagation();
    });
    
    // Prevent search bar clicks from triggering camera lock
    searchBar.addEventListener('click', function(e) {
        e.stopPropagation();
    });
    
    // Focus events for search bar
    searchBar.addEventListener('focus', function() {
        searchFocused = true;
        document.removeEventListener('keydown', window.onKeyDownHandler);
        document.removeEventListener('keyup', window.onKeyUpHandler);
        
        // Reset movement state
        moveForward = false;
        moveBackward = false;
        moveLeft = false;
        moveRight = false;
        moveUp = false;
        moveDown = false;
        boost = false;
        
        // Stop any camera movement immediately
        velocity.set(0, 0, 0);
    });
    
    searchBar.addEventListener('blur', function() {
        searchFocused = false;
        
        // Only restore controls if no modal is open
        if (!document.querySelector('.modal-overlay')) {
            document.addEventListener('keydown', window.onKeyDownHandler);
            document.addEventListener('keyup', window.onKeyUpHandler);
        }
    });
}

// Function to fly to a specific object
function flyToObject(path) {
    const objectInfo = objectsById.get(path);
    if (!objectInfo) return;
    
    // Exit pointer lock if active
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
    
    // Set up flying to the object position
    isFlying = true;
    
    // Get world position of the object
    const worldPosition = new THREE.Vector3();
    objectInfo.object.getWorldPosition(worldPosition);
    
    // Set target position slightly offset from the object
    const offsetDistance = 20; // Distance to keep from the object
    
    // For directory, set position above and to the side a bit
    if (objectInfo.type === 'Directory') {
        flyingTarget = new THREE.Vector3(
            worldPosition.x + offsetDistance,
            worldPosition.y + offsetDistance,
            worldPosition.z + offsetDistance
        );
    } else {
        // For files, position in front of the object
        flyingTarget = new THREE.Vector3(
            worldPosition.x,
            worldPosition.y,
            worldPosition.z + offsetDistance
        );
    }
    
    // Set the look-at point to be the object's position
    flyingLookAt = worldPosition;
    
    // Close search results
    document.getElementById('search-results').style.display = 'none';
}

function setFilesystemConnectionState(state) {
    filesystemConnectionState = state;
    const indicator = document.getElementById('filesystem-status');
    if (!indicator) return;

    indicator.textContent = state === 'LIVE'
        ? 'FILESYSTEM // LIVE'
        : state === 'RECONNECTING'
            ? 'FILESYSTEM // RECONNECTING'
            : 'FILESYSTEM // CONNECTING';

    indicator.classList.toggle('offline', state !== 'LIVE');
}

function initFilesystemWatcher() {
    if (!window.EventSource) {
        console.warn('HACKERS3D: EventSource is not supported; live filesystem updates disabled.');
        return;
    }

    filesystemEventSource = new EventSource('/api/events');
    setFilesystemConnectionState('CONNECTING');

    filesystemEventSource.addEventListener('open', () => {
        setFilesystemConnectionState('LIVE');
    });

    filesystemEventSource.addEventListener('ready', () => {
        setFilesystemConnectionState('LIVE');
    });

    filesystemEventSource.addEventListener('filesystem', () => {
        loadFilesystemData().catch(error => {
            console.error('HACKERS3D filesystem refresh failed:', error);
        });
    });

    filesystemEventSource.addEventListener('error', () => {
        setFilesystemConnectionState('RECONNECTING');
        console.warn('HACKERS3D filesystem event stream disconnected; reconnecting...');
    });

    window.addEventListener('beforeunload', () => {
        if (filesystemEventSource) filesystemEventSource.close();
    }, { once: true });
}

// Initialize and animate
init();
initFilesystemWatcher();
animate();