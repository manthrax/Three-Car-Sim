import * as THREE from 'three';

export class OrbitControls {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        
        // Target point to orbit around
        this.target = new THREE.Vector3(0, 0, 0);
        
        // Spherical coordinates for the camera
        this.radius = 15;
        this.theta = 0; // Horizontal angle
        this.phi = Math.PI / 4; // Vertical angle (45 degrees)
        
        // Mouse state
        this.isMouseDown = false;
        this.previousMousePosition = { x: 0, y: 0 };
        
        // Speed
        this.rotateSpeed = 0.005;
        this.zoomSpeed = 0.1;
        
        // Constraints
        this.minRadius = 2;
        this.maxRadius = 50;
        this.minPhi = 0.1;
        this.maxPhi = Math.PI - 0.1;
        
        // Bind methods
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onMouseWheel = this.onMouseWheel.bind(this);
        
        // Add event listeners
        this.domElement.addEventListener('mousedown', this.onMouseDown);
        this.domElement.addEventListener('mousemove', this.onMouseMove);
        this.domElement.addEventListener('mouseup', this.onMouseUp);
        this.domElement.addEventListener('wheel', this.onMouseWheel);
        
        // Initial update
        this.update();
    }
    
    onMouseDown(event) {
        this.isMouseDown = true;
        this.previousMousePosition = { x: event.clientX, y: event.clientY };
    }
    
    onMouseMove(event) {
        if (!this.isMouseDown) return;
        
        const deltaX = event.clientX - this.previousMousePosition.x;
        const deltaY = event.clientY - this.previousMousePosition.y;
        
        // Update angles based on mouse movement
        this.theta -= deltaX * this.rotateSpeed;
        this.phi -= deltaY * this.rotateSpeed;
        
        // Constrain phi
        this.phi = Math.max(this.minPhi, Math.min(this.maxPhi, this.phi));
        
        this.previousMousePosition = { x: event.clientX, y: event.clientY };
        this.update();
    }
    
    onMouseUp(event) {
        this.isMouseDown = false;
    }
    
    onMouseWheel(event) {
        event.preventDefault();
        
        // Zoom in/out
        const direction = event.deltaY > 0 ? 1 : -1;
        this.radius += direction * this.zoomSpeed * this.radius;
        
        // Constrain radius
        this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, this.radius));
        
        this.update();
    }
    
    update() {
        // Convert spherical coordinates to Cartesian
        const x = this.target.x + this.radius * Math.sin(this.phi) * Math.sin(this.theta);
        const y = this.target.y + this.radius * Math.cos(this.phi);
        const z = this.target.z + this.radius * Math.sin(this.phi) * Math.cos(this.theta);
        
        this.camera.position.set(x, y, z);
        this.camera.lookAt(this.target);
    }
    
    dispose() {
        this.domElement.removeEventListener('mousedown', this.onMouseDown);
        this.domElement.removeEventListener('mousemove', this.onMouseMove);
        this.domElement.removeEventListener('mouseup', this.onMouseUp);
        this.domElement.removeEventListener('wheel', this.onMouseWheel);
    }
}
