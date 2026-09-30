/* Skateboarding app JS*/
let background = document.getElementById('background');
let canvas1 = document.getElementById('canvas1');
let marginR = 0;
let marginL = 70;
let W = window.innerWidth - marginL - marginR;
let H = window.innerHeight;
background.width = W;
background.height = H;

canvas1.width = W;
canvas1.height = H;

let scale = 1;
let topBarMargin = 70;
let sideBarMargin = 270;
let sidePhyMargin = 30;

let paused = true;
let drawButton = false;
let resetButton = false;
let eraseButton = false;
let scaleButton = false;
// let resetDrag = false;
let homeX = 0;
let homeY = 5;
let mouseX = 0;
let mouseY = 0;
let CanvasOffsetX = W * 0.5;
let CanvasOffsetY = H * 0.5;
let trail = [];
let trails = [];
let graphs = [];
let gpinfo = [];
let mouseStatusDown = false;
let drawNewGrid = true;
let drawRemain = 65;
let scaleBeginMouse = {x: -1, y: -1};

let epsilon = 0.05;
let epsilonScale = 50;

let gravity = -9.8;
let fps = 60;
let debugMode = false;
let speedVectorContant = 2;
let collisionFriction = 0;
let timecountsmall = 0;
let timecountlarge = 0;
let sideMenuState = false;
let speedUnitsID = 0;
let selectedEquation = '';
let speedUnitsName = ['m/s', 'MPH', 'km/h'];
let speedUnitsValue = [1, 2.237, 3.6];
// variables of cloud save
let data;
let callback = function(data) {
    console.log(data);
};
let errorBack = function(data) {
    console.log(data);
};

let userID;
let projectID;
let flag1;
let flag2;

let joy = 0;
let ouch = 0;

// all the symbols and functions avalible for calculation
let legitSymbols = ['+', '-', '*', '/', ')', '(', '^'];
let legitFunctions = ['sin', 'cos', 'tan', 'log', 'sqrt'];

let lastTrailc = {x: 9007199254740991, y: 9007199254740991};
let minTrailLen = 0.2;

let ctxbg = background.getContext('2d'); /* layer for background info and grid*/
let ctx = canvas1.getContext('2d'); /* layer for trail*/
let skateboardpng = new Image();
skateboardpng.src ='images/skateboardman.png';
let skateboardhitpng = new Image();
skateboardhitpng.src ='images/skateboardmanhit.png';
let flagpng = new Image();
flagpng.src ='images/flag.png';

let equationData0 = [
    'y=2',
    'y=-0.5x',
    'y=-0.3x-2',
    'y=0.1x^2',
    'y=0.05*(x+5)^2',
    'y=sin(0.5x)-0.2x',
    'y=-3*log(0.1x+0.1)+0.4x-6',
    ''];
let equationData1 = [
    ['-10', '10'],
    ['-15', '25'],
    ['-10', '30'],
    ['-10', '6'],
    ['-17', '7'],
    ['-20', '25'],
    ['-20', '40']];

let projid = [];

let setup = function() {
    // jQuery setup
    $('html,body').css('cursor', 'move');
    $(window).resize(function() {
    location.reload();
    });
};

/**
 * Creates an instance of Skateboarder.
 *
 * @constructor
 * @author: yanlin
 * @this {Skateboarder}
 */
function Skateboarder() {
    this.x = homeX;
    this.y = homeY;
    this.vx = 1;
    this.vy = 0;
    this.angle = 0;
    this.angularV = 0;
    this.friction = 0;
    this.collisionR = 0.76;
    this.angularF = 0.9;
    this.valid = true;
    this.hit = 0;
    this.frontWheel = {x: 10, y: -20};
    this.rearWheel = {x: -10, y: -20};
    this.head = {x: 0, y: 20};
    this.onTrack = false;
    this.aeroFriction = 0.00272;
    this.trailDistance = 0.76;
    this.getSpeed = function() {
        return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    };
};


let Detectphone = function() {
    var uagent = navigator.userAgent.toLowerCase();
    let deviceList = ['android', 'webos', 'blackberry', 'bb', 'playbook', 'ipod', 'iemobile', 'windows phone', 'kindle', 'silk', 'opera mini','iphone', 'ipad', 'kindle'];
    for (let i = 0; i < deviceList.length; i++) {
        if (uagent.search(deviceList[i]) > -1){
            alert('Sorry, Skateboarding does not work properly for your device, ' + deviceList[i] + ' at this point');
        }
    }
}

// Get the modal
let modal = document.getElementById('helpPop');
// Get the <span> element that closes the modal
let span = document.getElementsByClassName('closehelp')[0];
// When the user clicks the button, open the modal

let displayHelp = function() {
    if (!paused) {
        start();
    }
    modal.style.display = 'block';
};
// When the user clicks on <span> (x), close the modal
span.onclick = function() {
    modal.style.display = 'none';
};
// When the user clicks anywhere outside of the div, close it
window.onclick = function(event) {
    if (event.target == modal) {
        modal.style.display = 'none';
    }
    if (event.target == infomodal) {
        infomodal.style.display = 'none';
    }
    if (!event.target.matches('.dropbtn')) {
        let dropdowns = document.getElementsByClassName('dropdown-content');
        let i;
        for (i = 0; i < dropdowns.length; i++) {
            let openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
};

let infomodal = document.getElementById('gameInfo');

let displayInfo = function(text, color='blue') {
    if (color == 'blue') {
        document.getElementById('infocont').style.background =
        'linear-gradient(#7ae1ff, #6ebbf1)';
    } else if (color == 'orange') {
        document.getElementById('infocont').style.background =
        'linear-gradient(#ee9168, #fd8672)';
    }

    document.getElementById('infoP').innerText = text;
    infomodal.style.display = 'block';
};

let closeInfo = function() {
    infomodal.style.display = 'none';
};

document.addEventListener('keydown', keyPush);
document.addEventListener('click', mouseClicks);
document.addEventListener('mousemove', mouseMoves);
document.addEventListener('mousedown', function() {
    mouseStatusDown = true;
});
document.addEventListener('mouseup', function() {
    if (trail.length > 2) {
        lastTrailc = {x: 9007199254740991, y: 9007199254740991};
        trails.push(trail);
        graphs.push('');
        gpinfo.push('');
        trail = [];
    }
    if (scaleButton) {
        scaleBeginMouse.x = -1;
        scaleBeginMouse.y = -1;
    }
    mouseStatusDown = false;
});

document.addEventListener('wheel', mousewheel);

/** translate canvas coordinates to object coordinates
 @param {object} ctxc - the canvas coordinate
 @param {int} ctxc.x - the canvas x-coordinate
 @param {int} ctxc.y - the canvas y-coordinate
 @return {object}
 */
function canvasToObj(ctxc) {
    return {x: ((ctxc.x - CanvasOffsetX)/ parseFloat(scale*epsilonScale) ),
    y: -(ctxc.y + CanvasOffsetY - H)/ parseFloat(scale*epsilonScale)};
}

/** translate object coordinates to canvas coordinates
    @param {object} objc - the object coordinate
    @param {int} objc.x - the object x-coordinate
    @param {int} objc.y - the object y-coordinate
    @return {object}
*/
function objToCanvas(objc) {
    return {x: parseInt( parseFloat(scale*epsilonScale)
        * objc.x + CanvasOffsetX),
    y: parseInt(H - parseFloat(scale*epsilonScale) * objc.y - CanvasOffsetY)};
}

/** get mouseclick position
    @param {event} event - the event
*/
function mouseClicks(event) {
    let clickX = event.clientX - marginL;
    if (event.clientY < topBarMargin) {
        return;
    }
    if (clickX > W-sideBarMargin-sidePhyMargin || clickX < 0) {
        return;
    }
    mouseX = clickX;
    mouseY = event.clientY;
    if (resetButton) {
        let objc = canvasToObj({x: mouseX, y: mouseY});
        homeX = objc.x;
        homeY = objc.y;
        skateBoarder.x = homeX;
        skateBoarder.y = homeY;
        updateScreen();
    }
    updateScreen();
}

/** hide the sidemenu
*/
function hideSideMenu() {
    document.getElementById('sideMenu').style.background =
    'rgba(220,220,220,0.2)';
    document.getElementById('sideMenu').style.width = '20px';
    sideBarMargin = 30;
    sideMenuState = false;
    drawNewGrid = true;
    updateScreen();
}
/** show the sidemenu
*/
function showSideMenu() {
    document.getElementById('sideMenu').style.background =
    'rgba(220,220,220,1)';
    document.getElementById('sideMenu').style.width = '270px';
    sideBarMargin = 270;
    sideMenuState = true;
    drawNewGrid = true;
    updateScreen();
}

let deleteGraph = function(id) {
    trails.splice(id, 1);
    let divid = graphs[id];
    if (divid != '') {
        let elem = document.getElementById(divid);
        elem.parentNode.removeChild(elem);
    }
    graphs.splice(id, 1);
    gpinfo.splice(id, 1);
    updateScreen();
};

/** get mouseMoves position
@param {event} event - the event
*/
function mouseMoves(event) {
    let clickX = event.clientX - marginL;
    if (event.clientY < topBarMargin) {
        return;
    }
    if (clickX > W-sideBarMargin-sidePhyMargin || clickX < 0) {
        if (!sideMenuState) {
            showSideMenu();
        }
        return;
    }
    let oldmouseX = mouseX;
    let oldmouseY = mouseY;
    mouseX = clickX;
    mouseY = event.clientY;
    let objc = canvasToObj({x: mouseX, y: mouseY});
    // scale the canvas by mouse
    if (scaleButton && mouseStatusDown) {
        if (scaleBeginMouse.x == -1 && scaleBeginMouse.y == -1) {
            scaleBeginMouse.x = mouseX;
            scaleBeginMouse.y = mouseY;
        }
        let oMouse = canvasToObj({x: scaleBeginMouse.x, y: scaleBeginMouse.y});
        let delta = Math.max(-5, Math.min(5, (oldmouseY - mouseY)/5));
        if (delta < 0) {
            $('html,body').css('cursor', 'zoom-out');
        }
        if (delta > 0) {
            $('html,body').css('cursor', 'zoom-in');
        }
        scale = Math.min(10, Math.max(
        0.0005, scale*(1+0.05*parseFloat(delta))));
        let cnMouse = objToCanvas(oMouse);
        CanvasOffsetX += scaleBeginMouse.x - cnMouse.x;
        CanvasOffsetY -= scaleBeginMouse.y - cnMouse.y;
        drawNewGrid = true;
        updateScreen();
    }
    // put a new node to the trail
    if (mouseStatusDown) {
        if (drawButton) {
            if (lastTrailc.x == 9007199254740991) {
                lastTrailc = objc;
            }
            if (getDistance(lastTrailc, objc) > minTrailLen) {
                if (!updateDrawBar(-1)) {
                    return;
                }
                trail.push(objc);
                updateScreen();
                drawTrail(trail);
                lastTrailc = objc;
            }
        }
        // erase any trails the mouse touches
        if (eraseButton) {
            for (let i=0; i<trails.length; i++) {
                for (let j=1; j<trails[i].length-1; j++) {
                    if (getDistance(objc, trails[i][j]) <
                        epsilon * 11 / scale) {
                        deleteGraph(i);
                        drawEraser(mouseX, mouseY, true);
                        return;
                    }
                }
            }
            updateScreen();
            drawTrail(trail);
            drawEraser(mouseX, mouseY);
        }
        // move the canvas
        if (!drawButton && !eraseButton && !scaleButton && !resetButton) {
            // drag an equation
            if (selectedEquation != '') {
                shiftEquation(selectedEquation,
                canvasToObj({x: mouseX, y: mouseY}),
                canvasToObj({x: oldmouseX, y: oldmouseY}));
            } else {
                CanvasOffsetX += mouseX - oldmouseX;
                CanvasOffsetY -= mouseY - oldmouseY;
                drawNewGrid = true;
                updateScreen();
            }
        }
    }
    printMouse(objc);
}

/** get mousewheel movements
    @param {event} event - the event
*/
function mousewheel(event) {
    let clickX = event.clientX - marginL;
    if (event.clientY < topBarMargin) {
        return;
    }
    if (clickX > W-sideBarMargin-sidePhyMargin) {
        return;
    }
    let oMouse = canvasToObj({x: mouseX, y: mouseY});
    let delta = Math.max(-1, Math.min(1, (event.wheelDelta || -event.detail)));
    scale = Math.min(10, Math.max(0.0005, scale*(1+0.05*parseFloat(delta))));
    let cnMouse = objToCanvas(oMouse);
    CanvasOffsetX += mouseX - cnMouse.x;
    CanvasOffsetY -= mouseY - cnMouse.y;
    drawNewGrid = true;
    updateScreen();
}

/** print mouse location on canvas
@param {object} objc - the object coordinate
@param {float} objc.x - the object x-coordinate
@param {float} objc.y - the object y-coordinate
*/
function printMouse(objc) {
    let textSize0 = Math.max(0, 3 - parseInt(Math.abs(objc.x*10)).
        toString().length);
    let textSize1 = Math.max(0, 3 - parseInt(Math.abs(objc.y*10)).
        toString().length);
    document.getElementById('coordinates').innerText =
    'x: '+objc.x.toFixed(textSize0) + '   y:'+objc.y.toFixed(textSize1);
}

/** wait for keypush
@param {event} evt - the event
*/
function keyPush(evt) {
    if (evt.ctrlKey && evt.code === 'KeyZ') {
        deleteGraph(trails.length-1);
        updateScreen(trails);
    }
    switch (evt.keyCode) {
        case 37:
            // skateBoarder.vx -= 5;
            break;
        case 38:
            if (skateBoarder.hit > 0) {
                skateBoarder.hit = 0;
                skateBoarder.vx += 4 * Math.cos((skateBoarder.angle + 90)
                * (Math.PI / 180));
                skateBoarder.vy += 4 * Math.sin((skateBoarder.angle + 90)
                * (Math.PI / 180));
            }
            break;
        case 39:
            // skateBoarder.vx += 5;
            break;
        case 40:
            // skateBoarder.vy -= 5;
            break;
        case 32:
            break;
        case 46:
            if (selectedEquation != '') {
                deleteGraph(graphs.indexOf(selectedEquation));
            }
        case 8:
            if (selectedEquation != '') {
                deleteGraph(graphs.indexOf(selectedEquation));
            }
    }
}

/** display all sample equations
*/
function clickSample() {
    uncheckAllButtons();
    document.getElementById('sampleEquation').classList.toggle('show');
}

let listSampleBtn = function(id) {
    listSample(id);
    drawGraphBtn();
};

let listSample = function(id) {
    document.getElementById('equationInput').value = equationData0[id];
    document.getElementById('equationStartX').value = equationData1[id][0];
    document.getElementById('equationEndX').value = equationData1[id][1];
};

/** check for parentheses
@param {String[]} items - the items
@return {int}
*/
function parentheses(items) {// -> [Int]{ find the first parentheses
    let pos = [-1, -1];
    let diff = 0;// the difference between'(' and ')'
    let i = 0;
    while (i < items.length) {
        if (items[i] == '(') {
            pos[0] = i;
        }
        i += 1;
    }

    if (items.length-1 > pos[0]) {
        i = pos[0]+1;
        while (i < items.length) {
            if (items[i] == '(') { // if inner parentheses exists
                diff += 1;
            } else if (items[i] == ')' && diff == 0) {
                pos[1] = i;
                break;
            } else if (items[i] == ')') {
                diff -= 1;
            }
            i += 1;
        }
    }
    return pos;
}

/** calculate the result of an expression
@param {String[]} items - the items
@return {int}
*/
function calculate(items) {
    let section = parentheses(items);
    let sp = []; // the items inside the first parentheses
    let items2 = [];
    let i = 0;
    while (i < items.length) {
        items2.push(items[i]);
        i += 1;
    }
    if (section[1]-section[0] > 1) {
        i = section[1] - 1;
        while (i > section[0]) {
            sp.push(items[i]);
            items2.splice(i, 1);
            i -= 1;
        }
        sp.reverse();
        items2.splice(section[0], 1);
        items2[section[0]] = calculate(sp).toString();
        return calculate(items2);
    } else {
        let i = 0;
        while (i < items2.length) {
            if (items2[i] == '^') {
                items2[i-1] = (Math.pow(parseFloat(items2[i-1]),
                parseFloat(items2[i+1]))).toString();
                items2.splice(i, 1);
                items2.splice(i, 1);
                i -= 1;
            }
            i += 1;
        }
        i = 0;
        while (i < items2.length) {
            if (items2[i] == 'sin') {
                items2[i] = (Math.sin(parseFloat(items2[i+1]))).toString();
                items2.splice(i+1, 1);
            }
            if (items2[i] == 'cos') {
                items2[i] = (Math.cos(parseFloat(items2[i+1]))).toString();
                items2.splice(i+1, 1);
            }
            if (items2[i] == 'tan') {
                items2[i] = (Math.tan(parseFloat(items2[i+1]))).toString();
                items2.splice(i+1, 1);
            }
            if (items2[i] == 'log') {
                items2[i] = (Math.log(parseFloat(items2[i+1]))).toString();
                items2.splice(i+1, 1);
            }
            if (items2[i] == 'sqrt') {
                items2[i] = (Math.sqrt(parseFloat(items2[i+1]))).toString();
                items2.splice(i+1, 1);
            }
            i += 1;
        }
        i = 0;
        while (i < items2.length) {
            if (items2[i] == '*') {
                items2[i-1] = (parseFloat(items2[i-1]) *
                parseFloat(items2[i+1])).toString();
                items2.splice(i, 1);
                items2.splice(i, 1);
                i -= 1;
            } else if (items2[i] == '/') {
                items2[i-1] = (parseFloat(items2[i-1]) /
                parseFloat(items2[i+1])).toString();
                items2.splice(i, 1);
                items2.splice(i, 1);
                i -= 1;
            }
            i += 1;
        }
        i = 0;
        while (i < items2.length) {
            if (items2[i] == '+') {
                items2[i-1] = (parseFloat(items2[i-1]) +
                parseFloat(items2[i+1])).toString();
                items2.splice(i, 1);
                items2.splice(i, 1);
                i -= 1;
            } else if (items2[i] == '-') {
                items2[i-1] = (parseFloat(items2[i-1]) -
                parseFloat(items2[i+1])).toString();
                items2.splice(i, 1);
                items2.splice(i, 1);
                i -= 1;
            }
            i += 1;
        }
    }
    return items2[0];
}

let calculateY = function(xc, eq) {
    let expressionList = eq.split(' ');
    expressionList = expressionList.filter(function(str) {
        return /\S/.test(str);
    });
    for (let j=0; j<expressionList.length; j++) {
        expressionList[j] = expressionList[j].trim();
        if (expressionList[j] == 'x') {
            expressionList[j] = xc.toString();
        }
    }
    return parseFloat(calculate(expressionList)).toString();
};

let createEquationBtn = function(eqt) {
    let newEqBtn = document.createElement('button');
    newEqBtn.setAttribute('id', eqt);
    newEqBtn.id = eqt;
    newEqBtn.setAttribute('class', 'button equations');
    newEqBtn.className = 'button equations';
    newEqBtn.innerHTML = eqt;
    newEqBtn.setAttribute('onclick', 'highLightTrail(equation);');
    newEqBtn.onclick = function() {
        highLightTrail(eqt);
    };
    let placeHolder = document.getElementById('equationList');
    placeHolder.appendChild(newEqBtn);
};

let editGraph = function() {
    if (selectedEquation != '') {
        deleteGraph(graphs.indexOf(selectedEquation));
    }
    drawGraphBtn();
};

let drawGraph = function(equation0, stax, endx) {
    if (graphs.indexOf(equation0) != -1) {
        deleteGraph(graphs.indexOf(equation0));
    } else {
        updateDrawBar(5);
    }
    let equationList = equation0.split('=');
    if (equationList.length != 2) {
        displayInfo('Invalid Equation', 'orange');
        return;
    }
    let equation = equationList[1];
    if (equation[0] == '-') {
        equation = '0' + equation;
    }
    for (let id = 0; id < equation.length; id++) {
        if (legitSymbols.indexOf(equation[id]) > -1) {
            equation = equation.slice(0, id) + ' ' + equation[id]
            + ' ' + equation.slice(id+1, equation.length);
            id += 2;
        } else if (equation[id+1] == 'x' &&
                   '0123456789'.indexOf(equation[id]) != -1) {
            equation = equation.slice(0, id+1) + ' * '
            + equation.slice(id+1, equation.length);
            id += 3;
        }
    }
    for (let id = 0; id < legitFunctions.length; id++) {
        let idx = equation.indexOf(legitFunctions[id]);
        if (idx > 0 && '0123456789'.indexOf(equation[idx-1]) != -1) {
            equation = equation.slice(0, idx) + ' * ' + legitFunctions[id] +
        ' ' + equation.slice(idx+legitFunctions[id].length, equation.length);
        } else if (idx > -1) {
            equation = equation.slice(0, idx) + ' ' + legitFunctions[id] +
        ' ' + equation.slice(idx+legitFunctions[id].length, equation.length);
        }
    }
    for (let xc=parseFloat(stax);
         xc<parseFloat(endx)+minTrailLen; xc+= minTrailLen) {
        trail.push({x: xc, y: calculateY(xc, equation)});
    }
    trails.push(trail);
    graphs.push(equation0);
    gpinfo.push([stax, endx]);
    trail = [];
    createEquationBtn(equation0);
    updateScreen();
};

/** draw a graph from an equation. The math equation is read from input
    The result of the equation is then calculated at every x coordinate
    to generate a trail
*/
function drawGraphBtn() {
    uncheckAllButtons();
    let equation0 = document.getElementById('equationInput').value;
    let stax = document.getElementById('equationStartX').value;
    let endx = document.getElementById('equationEndX').value;
    drawGraph(equation0, stax, endx);
    displayInfo('Graph Drawn');
    drawRemain += 1;
}

/** draw a man
@param {int} ox - the x coordinate
@param {int} oy - the y coordinate
*/
function drawFlag(ox, oy) {
    let cxy = objToCanvas({x: ox, y: oy});
    let width2 = flagpng.width/4*scale;
    let height2 = flagpng.height/4*scale;
    ctx.drawImage(flagpng, cxy.x, cxy.y-height2, width2, height2);
}

/** draw a player
@param {obj} obj - the obj representing a player
*/
function drawPlayer(obj) {
    drawMan(obj, obj.x, obj.y);
    if (debugMode) {
    ctx.beginPath();
    ctx.moveTo(obj.x, obj.y);
    ctx.lineTo(obj.x + 8*speedVectorContant*obj.vx, obj.y +
        8*speedVectorContant*obj.vy);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#de0000';
    ctx.stroke();
    }
}

let drawEraser = function(x2, y2, flagd = false) {
    ctx.beginPath();
    ctx.arc(x2, y2, 0.63*epsilonScale, 0, Math.PI*2);
    if (flagd) {
        ctx.fillStyle = 'rgba(255,0,0,0.4)';
    } else {
        ctx.fillStyle = 'rgba(220,220,220,0.4)';
    }

    ctx.fill();
    ctx.lineWidth = 1;
    if (flagd) {
        ctx.strokeStyle = '#FF0000';
    } else {
        ctx.strokeStyle = '#333';
    }
    ctx.stroke();
};


/** draw a player
@param {object} obj - the obj representing a player
@param {int} ox - the x coordinate
@param {int} oy - the y coordinate
*/
function drawMan(obj, ox, oy) {
    let cxy = objToCanvas({x: ox, y: oy});
    /*
    ctx.beginPath();
    ctx.arc(cxy.x, cxy.y, obj.collisionR*scale*epsilonScale, 0, Math.PI*2);
    ctx.fillStyle = '#0086fc';
    ctx.fill();*/
    let x2 = cxy.x;
    let y2 = cxy.y;
    let width2 = skateboardpng.width/3.8;
    let height2 = skateboardpng.height/3.8;
    if (obj.onTrack) {
        height2 *= Math.max(0.7, (1+2*obj.trailDistance/obj.collisionR)/3);
    }
    width2 *= scale;
    height2 *= scale;
    ctx.translate(x2, y2);
    ctx.rotate(-obj.angle*Math.PI/180);
    if (obj.valid && obj.hit == 0) {
        ctx.drawImage(skateboardpng,
        -width2 / 2, -height2 / 2, width2, height2);
    } else if (obj.hit > 0) {
        ctx.drawImage(skateboardhitpng, -width2 / 2,
        -height2 / 2, width2, height2);
        obj.hit -= 1;
    }
    ctx.rotate(obj.angle*Math.PI/180);
    ctx.translate(-x2, -y2);
}

let shiftEquation = function(text, fd, sd, shiftwhole = true) {
    let id = graphs.indexOf(text);
    let sx = sd.x - fd.x;
    let sy = sd.y - fd.y;
    if (shiftwhole) {
        for (let i=0; i<trails[id].length; i++) {
            trails[id][i].x -= sx;
            trails[id][i].y -= sy;
        }
        highLightTrail(text);
    } else {
        stx = (gpinfo[id][0] - sx).toFixed(2);
        edx = (gpinfo[id][1] - sx).toFixed(2);
        deleteGraph(graphs.indexOf(text));
        uncheckAllButtons();
        let equationList = text.split('=');
        console.log(equationList[0] + '=' + sy.toFixed(2) + equationList[1]);
        selectedEquation = text;
        drawGraph(selectedEquation, stx, edx);
        highLightTrail(text);
    }
};

let highLightTrail = function(text) {
    uncheckAllButtons();
    updateScreen();
    drawTrail(trails[graphs.indexOf(text)], 6, '#0086fc', '#0004b3');
    selectedEquation = text;
    document.getElementById('equationInput').value =
    graphs[graphs.indexOf(text)];
    document.getElementById('equationStartX').value =
    gpinfo[graphs.indexOf(text)][0];
    document.getElementById('equationEndX').value =
    gpinfo[graphs.indexOf(text)][1];
};

let drawTrail = function(
    oneTrail, widh = 3, colr0 = '#000000', colr1 = '#0086fc') {
    if (oneTrail.length>0) {
        ctx.beginPath();
        let cxy = objToCanvas({x: oneTrail[0].x,
        y: oneTrail[0].y});
        ctx.moveTo(cxy.x, widh/2+cxy.y);
        for (let i=1; i<oneTrail.length; i++) {
            cxy = objToCanvas({x: oneTrail[i].x,
            y: oneTrail[i].y});
            ctx.lineTo(cxy.x, widh/2 * scale + cxy.y);
        }
        ctx.lineWidth = widh * scale;
        ctx.strokeStyle = colr1;
        ctx.stroke();

        ctx.beginPath();
        cxy = objToCanvas({x: oneTrail[0].x,
        y: oneTrail[0].y});
        ctx.moveTo(cxy.x, cxy.y);
        for (let i=1; i<oneTrail.length; i++) {
            cxy = objToCanvas({x: oneTrail[i].x,
            y: oneTrail[i].y});
            ctx.lineTo(cxy.x, cxy.y);
        }
        ctx.lineWidth = widh * scale;
        ctx.strokeStyle = colr0;
        ctx.stroke();
    }
};

let drawTrails = function(trails) {
    for (let i=0; i<trails.length; i++) {
        drawTrail(trails[i]);
    }
};

/** draw the grid on the canvas
*/
function drawGrid() {
    ctxbg.clearRect(0, 0, W, H);
    let o00 = canvasToObj({x: 0, y: 0});
    let oWH = canvasToObj({x: W, y: H});
    let corigin = objToCanvas({x: 0, y: 0});

    if (corigin.x <=W && corigin.x >=0) {
        ctxbg.beginPath();
        ctxbg.moveTo(corigin.x, 0);
        ctxbg.lineTo(corigin.x, H);
        ctxbg.lineWidth = 1;
        ctxbg.strokeStyle = '#000000';
        ctxbg.stroke();
    }
    if (corigin.y <=H && corigin.y >=0) {
        ctxbg.beginPath();
        ctxbg.moveTo(0, corigin.y);
        ctxbg.lineTo(W, corigin.y);
        ctxbg.lineWidth = 1;
        ctxbg.strokeStyle = '#000000';
        ctxbg.stroke();
    }

    let gridSize = 0.001;
    let maxgridsize = W/20/(scale*epsilonScale);
    for (let c = 0; gridSize <= maxgridsize; c++) {
        if (c % 3 == 1) { // alternate 2, 5, 10
            gridSize *= 1.25;
        }
        gridSize *= 2;
    }
    let textSize = 0;
    if (gridSize < 1) {
        textSize = 1;
    }
    for (let i = Math.round(o00.x/gridSize);
            i <= Math.round(oWH.x/gridSize); i++) {
        let pt = objToCanvas({x: gridSize*i, y: 0});
        // drawLabel
        let textY = Math.min(H-5, Math.max(corigin.y, 20+topBarMargin));
        ctxbg.font = '16px Consolas';
        ctxbg.fillStyle = '#111111';
        ctxbg.fillText((gridSize*i).toFixed(textSize), pt.x+1, textY-3);
        // drawGrid
        ctxbg.beginPath();

        ctxbg.moveTo(pt.x, 0);
        ctxbg.lineTo(pt.x, H);
        ctxbg.lineWidth = 0.3;
        ctxbg.strokeStyle = '#000000';
        ctxbg.stroke();
    }
    for (let i = Math.round(oWH.y/gridSize);
            i <= Math.round(o00.y/gridSize); i++) {
        let pt = objToCanvas({x: 0, y: gridSize*i});
        // drawLabel
        let textX =
        Math.min(W-sideBarMargin-sidePhyMargin, Math.max(corigin.x, 0));
        ctxbg.font = '16px Consolas';
        ctxbg.fillStyle = '#111111';
        ctxbg.fillText((gridSize*i).toFixed(textSize), textX+1, pt.y-3);
        // drawGrid
        ctxbg.beginPath();

        ctxbg.moveTo(0, pt.y);
        ctxbg.lineTo(W, pt.y);
        ctxbg.lineWidth = 0.3;
        ctxbg.strokeStyle = '#000000';
        ctxbg.stroke();
    }
}

/** refresh all changed items on the canvas
*/
function updateScreen() {
    selectedEquation = '';
    ctx.clearRect(0, 0, W, H);
    if (!paused) {
        CanvasOffsetX -= parseInt(Math.min(1, skateBoarder.getSpeed()/10)
        * (scale*epsilonScale) * (skateBoarder.vx/fps));
        CanvasOffsetY -= parseInt(Math.min(1, skateBoarder.getSpeed()/10)
        * (scale*epsilonScale) * (skateBoarder.vy/fps));
        drawNewGrid = true;
    }
    drawFlag(homeX, homeY);
    drawTrails(trails);
    drawPlayer(skateBoarder);

    if (drawNewGrid) {
        drawGrid();
        drawNewGrid = false;
    }
}

let uncheckAllButtons = function() {
    $('html,body').css('cursor', 'move');
    drawButton = false;
    resetButton = false;
    eraseButton = false;
    scaleButton = false;
    resetDrag = false;
    document.getElementById('draw').style.boxShadow = 'none';
    document.getElementById('draw').style.boxShadow = 'none';
    document.getElementById('erase').style.boxShadow = 'none';
    document.getElementById('reset').style.boxShadow = 'none';
    document.getElementById('zoom').style.boxShadow = 'none';
    updateScreen();
};

/** move button
*/
function zoomButton() {
    let before = scaleButton;
    uncheckAllButtons();
    if (before) {
        $('html,body').css('cursor', 'move');
    } else {
        document.getElementById('zoom').style.boxShadow =
        '0px 0px 0px 5px #66b3ff';
        $('html,body').css('cursor', 'zoom-in');
    }
    scaleButton = !before;
}

/** draw button
*/
function drawTrailButton() {
    if (paused) {
        if (drawRemain <= 0) {
            displayInfo('You have no pencil left!\n\nPencils can be gained '+
            'from entering math equations.', 'orange');
        }
        let before = drawButton;
        uncheckAllButtons();
        if (before) {
            $('html,body').css('cursor', 'move');
        } else {
            document.getElementById('draw').style.boxShadow =
            '0px 0px 0px 5px #ff6666';
            $('html,body').css('cursor', 'default');
        }
        drawButton = !before;
    }
}

/** erase button
*/
function eraseTrailButton() {
    if (paused) {
        let before = eraseButton;
            uncheckAllButtons();
        if (before) {
            $('html,body').css('cursor', 'move');
        } else {
            document.getElementById('erase').style.boxShadow =
            '0px 0px 0px 5px #ffb366';
            $('html,body').css('cursor', 'default');
        }
        eraseButton = !before;
    }
}

/** start button
*/
function start() {
    updateScore(-1);
    uncheckAllButtons();
    if (paused) {
        paused = false;
        document.getElementById('draw').style.opacity = '0.3';
        document.getElementById('erase').style.opacity = '0.3';
        document.getElementById('reset').style.opacity = '0.3';
    } else {
        paused = true;
        document.getElementById('draw').style.opacity = '1';
        document.getElementById('erase').style.opacity = '1';
        document.getElementById('reset').style.opacity = '1';
    }
    if (!paused) {
        hideSideMenu();
        simulate();
    } else {
        showSideMenu();
    }
}

/** restart button
*/
function restartButton() {
    uncheckAllButtons();
    if (!paused) {
        gameover();
    } else {
        restart();
    }
}

let gameover = function() {
    let ginfo = 'Gameover\nJoy: ' + joy.toString() + '\nOuch: ' +
    ouch.toString() + '\nScore: ' + parseInt(50 * joy/(ouch+1)).toString();
    displayInfo(ginfo);
    restart();
};

/** restart the game
*/
function restart() {
    showSideMenu();
    uncheckAllButtons();
    skateBoarder = new Skateboarder();
    if (paused) {
        scale = 1;
        CanvasOffsetX = W * 0.5 - homeX * epsilonScale;
        CanvasOffsetY = H * 0.5 - homeY * epsilonScale;
    }
    timecountlarge = 0;
    timecountsmall = 0;
    joy = 0;
    ouch = 0;
    displaySpeed();
    drawNewGrid = true;
    updateScreen();
    drawPlayer(skateBoarder);
    paused = true;
    document.getElementById('draw').style.opacity = '1';
    document.getElementById('erase').style.opacity = '1';
    document.getElementById('reset').style.opacity = '1';
}

/** reset to start
*/
function reset() {
    if (paused) {
        let before = resetButton;
        updateScreen();
        if (before) {
            $('html,body').css('cursor', 'move');
        } else {
            document.getElementById('reset').style.boxShadow =
            '0px 0px 0px 5px #44b42e';
            $('html,body').css('cursor', 'default');
        }
        resetButton = !before;
    }
}

let parseSaveFile = function() {
    let data = {};
    data['trails'] = [];
    data['graphs'] = [];
    data['gpinfo'] = [];
    data['home'] = {x: homeX, y: homeY};
    for (let i = 0; i < trails.length; i++) {
        data['trails'].push(trails[i]);
        data['graphs'].push(graphs[i]);
        data['gpinfo'].push(gpinfo[i]);
    }
    return JSON.stringify(data);
};

/** convert the save files to trails
    @param {String} txt - The text data of the save file
*/
function parseLoadFile(txt) {
    for (let i = 0; i < graphs.length; i++) {
        let elem = document.getElementById(graphs[i]);
        elem.parentNode.removeChild(elem);
    }
    trails = [];
    graphs = [];
    gpinfo = [];
    let data = JSON.parse(txt);
    homeX = data.home.x;
    homeY = data.home.y;
    for (let i=0; i<data.trails.length; i++) {
        trails.push(data.trails[i]);
        graphs.push(data.graphs[i]);
        gpinfo.push(data.gpinfo[i]);
        if (data.graphs[i] != '') {
            createEquationBtn(data.graphs[i]);
        }
    }
    updateScreen();
    restartButton();
}

/** user login
*/
function userLogin() {
    let cloud = new CloudSaver();
    uncheckAllButtons();
    let logincallback = function(data) {
        userID = data.id;
        console.log(data);
        let elem = document.getElementById('login');
        elem.parentNode.removeChild(elem);
    };
    cloud.loginPopup(logincallback, errorBack);
}

let saveGameButton = function() {
    uncheckAllButtons();
    document.getElementById('saveGameMenu').classList.toggle('show');
};

let saveGameLocal = function() {
    uncheckAllButtons();
    let dt = new Date();
    dt.getDate();
    let text = parseSaveFile();
    let filename = 'skateboarding_'+(dt.getFullYear() + 1).toString()+'_'+
        (dt.getMonth() + 1).toString()+'_'+(dt.getDate() + 1).toString();

    let pom = document.createElement('a');
        pom.setAttribute('href', 'data:text/plain;charset=utf-8,' +
            encodeURIComponent(text));
        pom.setAttribute('download', filename);
        if (document.createEvent) {
            let event = document.createEvent('MouseEvents');
            event.initEvent('click', true, true);
            pom.dispatchEvent(event);
        } else {
            pom.click();
        }
};

/** save the trails drawn and spawn location
*/
function saveGameCloud() {
    let cloud = new CloudSaver();
    uncheckAllButtons();
    let data = parseSaveFile();
    let blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
    let formData = new FormData();
    formData.append('file', blob);

    let callbackFile = function(data) {
        let dt = new Date();
        dt.getDate();
        let filename = 'skateboarding_'+(dt.getFullYear() + 1).toString()+'_'+
        (dt.getMonth() + 1).toString()+'_'+(dt.getDate() + 1).toString();
        let saveName = prompt(
        'Please enter the name of the save file:', filename);
        if (saveName == null || saveName == '') {
            filename = 'Invalid name';
            return;
        } else {
            filename = saveName;
        }
        let applicationID = 70;
        let dataID = data.id;
        let imgID = 1000;

        if (true) {
            cloud.createProject(filename, applicationID, dataID,
                imgID, callback, errorBack);
        } else {
            cloud.updateProject(globals.projectID, filename,
            applicationID, dataID, imgID, callback, errorBack);
        }
    };

    cloud.saveFile(formData, callbackFile, errorBack);
    console.log('savefile');
}

/** load the trails drawn and spawn location
*/
function loadGameButton() {
    uncheckAllButtons();
    document.getElementById('loadGameMenu').classList.toggle('show');
    if (userID != null) {
        loadGameCloud();
    }
}


let loadProj = function(pid) {
    let cloud = new CloudSaver();
    uncheckAllButtons();
    document.getElementById('loadGameMenu').classList.toggle('show');
    console.log(pid);
    let callbackLoad = function(data) {
        parseLoadFile(JSON.parse(data));
    };
    cloud.loadProject(pid, callbackLoad, errorBack);
};

/** load the trails drawn and spawn location
*/
function loadGameCloud() {
    uncheckAllButtons();
    for (i = 0; i < projid.length; i++) {
        let elem = document.getElementById(projid[i]);
        elem.parentNode.removeChild(elem);
    }
    projid = [];
    let cloud = new CloudSaver();
    let callbackUser = function(data) {
        let userID = data.id;
        let callbackList = function(data) {
            for (i = 0; i < data.length; i++) {
                console.log(data[i]);
                projid.push(data[i].id);
                name = data[i].name;
                let projBtn = document.createElement('button');
                projBtn.setAttribute('id', projid[i]);
                projBtn.id = projid[i];
                projBtn.setAttribute('class', 'button equations');
                projBtn.className = 'button equations';
                projBtn.innerHTML = name;
                projBtn.setAttribute(
                'onclick', 'loadProj('+projid[i].toString()+')');
                projBtn.style.width = '240px';
                //
                let placeHolder = document.getElementById('loadGameMenu');
                placeHolder.appendChild(projBtn);
            }
        };
        cloud.listProject(userID, callbackList, errorBack);
    };
    cloud.getUser(callbackUser, errorBack);
}

const input = document.querySelector('#loadlocal');

input.addEventListener('change', () => {
  const file = input.files.item(0);
  fileToText(file, (text) => {
    parseLoadFile(text);
  });
});

/** read file
    @param {string} file thecontent
    @param {function} callback
*/
function fileToText(file, callback) {
  const reader = new FileReader();
  reader.readAsText(file);
  reader.onload = () => {
    callback(reader.result);
  };
}

/** save
    @param {String} content of the save file
    @param {Srring} fileName the name of save file
*/
function save(content, fileName) {
  const blob = new Blob([content], {
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
}

/** update the player position based on speed and gravity.
    @param {Skateboarder} obj the player in game
*/
function updatePlayer(obj) {
    let spd = obj.getSpeed();
    let aF = Math.pow(spd, 2)*obj.aeroFriction;
    obj.vx -= aF*obj.vx/spd/fps;
    obj.vy -= aF*obj.vy/spd/fps;
    obj.x += obj.vx/fps;
    obj.y += obj.vy/fps;
    obj.vy += gravity/fps;
    obj.angle += obj.angularV/fps;
    obj.angularV *= obj.angularF;
    // auto center
    if (obj.hit == 0) {
        obj.angularV += 0.05*(0-obj.angle);
    }
}

/** get the distance between two nodes
    @param {object} a - the first node
    @param {object} b - the second node
    @return {float}
*/
function getDistance(a, b) {
    return Math.sqrt((a.x-b.x) * (a.x-b.x) + (a.y-b.y) * (a.y-b.y));
}

/** get the dot product of two vectors
    @param {object} lineAStart - the first node of first line
    @param {object} lineAEnd - the second node of first line
    @param {object} lineBStart - the first node of second line
    @param {object} lineBEnd - the second node of second line
    @return {float}
*/
function dotProduct(lineAStart, lineAEnd, lineBStart, lineBEnd) {
    let lineAX = lineAEnd.x - lineAStart.x;
    let lineAY = lineAEnd.y - lineAStart.y;
    let lineBX = lineBEnd.x - lineBStart.x;
    let lineBY = lineBEnd.y - lineBStart.y;
    return lineAX*lineBX + lineAY*lineBY;
}

/** check if two lines intersect
    @param {object} lineAStart - the first node of first line
    @param {object} lineAEnd - the second node of first line
    @param {object} lineBStart - the first node of second line
    @param {object} lineBEnd - the second node of second line
    @return {boolean}
*/

 /** find the shortest distance from dot to line
     brief Reflect point p along line through points p0 and p1
     * @param {object} p0 - dot
     * @param {object} p1 - first point of line
     * @param {object} p2 - second point of line
     * @return {object}
     */
function dotLineDistance(p0, p1, p2) {
    let vertDistance = Math.abs(
    (p2.y-p1.y)*p0.x - (p2.x-p1.x)*p0.y + p2.x*p1.y - p2.y*p1.x)
    /Math.sqrt((p2.y-p1.y) * (p2.y-p1.y) + (p2.x-p1.x) * (p2.x-p1.x));
    return vertDistance;
}


 /** mirror two dots
     brief Reflect point p along line through points p0 and p1
     * @param {object} p - point to reflect
     * @param {object} p0 - first point for reflection line
     * @param {object} p1 - second point for reflection line
     * @return {object}
     */
function mirrorPoint(p, p0, p1) {
    let dx = p1.x - p0.x;
    let dy = p1.y - p0.y;
    let a = (dx * dx - dy * dy) / (dx * dx + dy * dy);
    let b = 2 * dx * dy / (dx * dx + dy * dy);
    let x = a * (p.x - p0.x) + b * (p.y - p0.y) + p0.x;
    let y = parseFloat(b) * parseFloat(p.x - p0.x) -
        parseFloat(a) * parseFloat(parseFloat(p.y) - p0.y) + parseFloat(p0.y);
    return {x: x, y: y};
}

/** mirror two vectors
     Reflect vector p along line through points p0 and p1
     * @param {object} v - vector to reflect
     * @param {object} p0 - first point for reflection line
     * @param {object} p1 - second point for reflection line
     * @return {object}
*/
function mirrorVector(v, p0, p1) {
    let startP = {x: 0, y: 0};
    let endP = {x: v.x, y: v.y};
    let mstartP = mirrorPoint(startP, p0, p1);
    let mendP = mirrorPoint(endP, p0, p1);
    return {x: mendP.x-mstartP.x, y: mendP.y-mstartP.y};
}

 /** change the player status after collision
     * @param {Skateboarder} obj - the player
     * @param {objectp} lineStart - first point for reflection line
     * @param {object} lineEnd - second point for reflection line
     * @param {float} dotlinedis - the distance from object to line
     */
function collide(obj, lineStart, lineEnd, dotlinedis) {
    obj.hit = 40;
    let mirroredVector = mirrorVector({x: obj.vx, y: obj.vy},
        lineStart, lineEnd);
    let intensity = Math.sqrt((mirroredVector.x-obj.vx) *
        (mirroredVector.x-obj.vx) + (mirroredVector.y-obj.vy) *
        (mirroredVector.y-obj.vy));
    let vertLine = {x: lineStart.y-lineEnd.y, y: lineEnd.x-lineStart.x};
    let vertLen = Math.sqrt(vertLine.x * vertLine.x + vertLine.y * vertLine.y);
    if (dotProduct( {x: 0, y: 0}, vertLine, {x: 0, y: 0}, mirroredVector)
        < 0) {
        vertLine.x = -0.5*vertLine.x;
        vertLine.y = -0.5*vertLine.y;
    }
    obj.trailDistance = dotLineDistance(obj, lineStart, lineEnd);
    if (obj.trailDistance < 0.3 * obj.collisionR) {
        displayInfo('Bruised Knees', 'orange');
        let oldvx = obj.vx;
        let oldvy = obj.vy;
        obj.vx = mirroredVector.x *
        Math.max(0.5, 1-collisionFriction*intensity);
        obj.vy = mirroredVector.y *
        Math.max(0.5, 1-collisionFriction*intensity);
        obj.vx *= (1-obj.friction);
        obj.vy *= (1-obj.friction);
        updateScore(Math.pow(
        (obj.vx-oldvx)*(obj.vx-oldvx) + (obj.vy-oldvy)*(obj.vy-oldvy), 0.5));
    } else {
        let force = 0.5 + obj.collisionR/(dotlinedis+0.25*obj.collisionR);
        obj.vx += force * vertLine.x / vertLen;
        obj.vy += force * vertLine.y / vertLen;
    }
    // vertical friction
    if (!obj.onTrack) {
        obj.vx = obj.vx* (1 - 0 * vertLine.x / vertLen);
        obj.vy = obj.vy* (1 - 0 * vertLine.y / vertLen);
    }
    // new angle after collide with track
    let newangle = (Math.atan2(lineEnd.y-lineStart.y, lineEnd.x-lineStart.x)
        * 180 / Math.PI);
    // calculate which side of the line is the object on
    if ((obj.x-lineStart.x) * (lineEnd.y - lineStart.y) - (obj.y - lineStart.y)
        * (lineEnd.x - lineStart.x) > 0) {
        newangle += 180;
        if (newangle > 180) {
            newangle -= 360;
        }
    }
    let angleChange = newangle-obj.angle;
    if (angleChange > 180) {
        angleChange -= 360;
    } else if (angleChange < -180) {
        angleChange += 360;
    }
    obj.angularV += 3*angleChange;

    if (angleChange > 110) {
        console.log('crashed');
        displayInfo('Hit the head!', 'orange');
        updateScore(0.3 * Math.pow(obj.vx*obj.vx + obj.vy*obj.vy, 0.5));
    }
    // obj.angle = newangle;
}

 /** check if the player will have collision with any trail
     * @param {Skateboarder} obj - the player
     */
function collision(obj) {
    if (trails.length == 0) return;
    let closestNode = {x: 0, y: 0, distance: W+H, i: -1, j: -1};
    let i;
    let j;
    for (i=0; i<trails.length; i++) {
        for (j=1; j<trails[i].length-1; j++) {
            let closestDistance = getDistance(obj, trails[i][j]);
            if (closestNode.distance >= closestDistance &&
                dotProduct(obj, {x: trails[i][j].x, y: trails[i][j].y},
                           obj, {x: obj.x + speedVectorContant * obj.vx,
                           y: obj.y + speedVectorContant * obj.vy}) >= 0) {
                closestNode.distance = closestDistance;
                closestNode.x = trails[i][j].x;
                closestNode.y = trails[i][j].y;
                closestNode.i = i;
                closestNode.j = j;
            }
        }
    }
    if (debugMode) {
        if (closestNode.x!=0 && closestNode.y!=0) {
            ctx.beginPath();
            ctx.moveTo(obj.x, obj.y);
            ctx.lineTo(closestNode.x, closestNode.y);
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#000000';
            ctx.stroke();
        }
    }
    if (closestNode.j>0 && closestNode.i>=0) {
        let dldist = dotLineDistance(
        obj, trails[closestNode.i][closestNode.j-1],
             trails[closestNode.i][closestNode.j]);
        let d0dist = getDistance(
        trails[closestNode.i][closestNode.j-1], {x: obj.x, y: obj.y});
        let d1dist = getDistance(
        trails[closestNode.i][closestNode.j], {x: obj.x, y: obj.y});
        let v0dist = Math.sqrt(d0dist*d0dist-dldist*dldist);
        let v1dist = Math.sqrt(d1dist*d1dist-dldist*dldist);
        let llen = getDistance(trails[closestNode.i][closestNode.j-1],
        trails[closestNode.i][closestNode.j]);
        if ((dldist < obj.collisionR) && (llen > v0dist || llen > v1dist)) {
            collide(obj, trails[closestNode.i][closestNode.j-1],
                    trails[closestNode.i][closestNode.j], dldist);
            obj.onTrack = true;
            return;
        }
    }
    obj.onTrack = false;
}

/** change the unit of speedometer on click
*/
function changeSpeedometerUnit() {
    uncheckAllButtons();
    speedUnitsID = (speedUnitsID + 1) % 3;
    document.getElementById('speedometertext1').innerText =
    speedUnitsName[speedUnitsID];
    displaySpeed();
}

/** display the speed
*/
function displaySpeed() {
    let spd = skateBoarder.getSpeed()-1;
    let speedinfo = (spd/30*18).toString()+' 19 18';
    document.getElementById('speedometerringbar').style.strokeDasharray =
    speedinfo;
    document.getElementById('speedometertext').innerText =
    parseInt(speedUnitsValue[speedUnitsID] * spd).toString().padStart(2, ' ');
}

let updateScore = function(force = 0) {
    joy += Math.max(2, parseInt(skateBoarder.getSpeed())) - 2;
    document.getElementById('joyBtn').innerText = joy;
    if (force > 0) {
        ouch += 1 + 10 * parseInt(force);
        document.getElementById('ouchBtn').innerText = ouch;
    } else if (force == -1) {
        document.getElementById('ouchBtn').innerText = ouch;
        document.getElementById('viewoverlay').style.opacity = 0;
    }
    if (ouch > 300) {
        displayInfo(
        'It hurts too much, let\'s redesign the track and restart', 'orange');
        gameover();
    }
};

let updateDrawBar = function(val) {
    if (!val+1) {
        if (drawRemain <= 0) {
            return false;
        }
    }
    drawRemain += val;
    let nh = parseInt(Math.min(150, 2*drawRemain + 20)).toString()+'px';
    if (drawRemain < 1) {
        nh = '0px';
    }
    document.getElementById('penbara').style.height = nh;
    return true;
};

let updateTime = function() {
    timecountsmall += 1;
    if (timecountsmall % 60 == 0) {
        timecountlarge += 1;
        timecountsmall = 0;
        updateScore();
    }
    if (timecountsmall % 2 == 0) {
        document.getElementById('fps').innerText = timer.fps().toString();
        displaySpeed();
    }
    if (ouch > 0) {
        document.getElementById('viewoverlay').style.opacity = Math.min(1,
        0.003 * ouch) * Math.cos(timecountsmall/9.549297);
    }
};

let Timer = function () {
    this.elapsed = 0
    this.last = null
}
Timer.prototype = {
    tick: function (now) {
        this.elapsed = (now - (this.last || now)) / 1000
        this.last = now  
    },  
    fps: function () {
        return Math.round(1 / this.elapsed)
    }
}
let timer = new Timer()
 /** do one frame in the simulation
 */
function simulate() {
    timer.tick(Date.now());
    updateTime();
    updateScreen();
    drawPlayer(skateBoarder);
    updatePlayer(skateBoarder);
    collision(skateBoarder);

    if (!paused) {
        window.requestAnimationFrame(simulate);
    }
}

 /** start the simulation
 */
function gameStart() {
    displayHelp();
    skateBoarder = new Skateboarder();
    if (false) {
        console.log(data);
        console.log(userID);
        console.log(projectID);
        console.log(flag1);
        console.log(flag2);
        console.log(timecountlarge);
        moveButton();
        zoomButton();
        closeInfo();
        drawTrailButton();
        eraseTrailButton();
        drawGraph();
        editGraph();
        reset();
        restartButton();
        start();
        clickSample();
        listSample();
        saveGameButton();
        loadGameButton();
        saveGameLocal();
        saveGameCloud();
        loadGameCloud();
        save();
        userLogin();
        listSampleBtn();
        changeSpeedometerUnit();
        loadProj();
    }
    simulate();
}
setup();
Detectphone();
gameStart();

