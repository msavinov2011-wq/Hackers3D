/* HACKERS3D reusable GLB scene bridge.
 * The binary asset is expected at /static/assets/hackers_network.glb.
 * The app keeps a procedural fallback when the asset is unavailable.
 */
window.HACKERS_NETWORK_ASSETS = {
    ready: false,
    failed: false,
    file: null,
    directory: null,
    core: null,
    connection: null,
    pulse: null,
    networkCore: null
};

window.HACKERS_NETWORK_READY = new Promise((resolve) => {
    window.__hackersNetworkResolve = resolve;
});

(function loadHackersNetworkAsset() {
    if (!window.THREE || !window.THREE.GLTFLoader) {
        window.HACKERS_NETWORK_ASSETS.failed = true;
        window.__hackersNetworkResolve(false);
        return;
    }

    const loader = new THREE.GLTFLoader();
    loader.load(
        '/static/assets/hackers_network.glb',
        function (gltf) {
            const root = gltf.scene;
            const assets = window.HACKERS_NETWORK_ASSETS;

            assets.file = root.getObjectByName('FILE_NODE_TEMPLATE');
            assets.directory = root.getObjectByName('DIRECTORY_NODE_TEMPLATE');
            assets.core = root.getObjectByName('CORE_NODE_TEMPLATE');
            assets.connection = root.getObjectByName('CONNECTION_TEMPLATE');
            assets.pulse = root.getObjectByName('PULSE_TEMPLATE');
            assets.networkCore = root.getObjectByName('NETWORK_CORE');

            const required = [
                assets.file,
                assets.directory,
                assets.core,
                assets.connection,
                assets.pulse,
                assets.networkCore
            ];

            if (required.some(item => !item)) {
                throw new Error('HACKERS_NETWORK: required template object is missing');
            }

            // Templates share geometry/materials with their clones. Keep the
            // source scene detached so the 321-node preview is not rendered twice.
            assets.ready = true;
            console.info('HACKERS3D: GLB network scene templates loaded');
            window.__hackersNetworkResolve(true);
        },
        undefined,
        function (error) {
            assets.failed = true;
            console.warn('HACKERS3D: network GLB unavailable, using procedural fallback.', error);
            window.__hackersNetworkResolve(false);
        }
    );
})();
