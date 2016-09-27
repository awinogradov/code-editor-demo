var aceExample = (function(ace, AceMultiCursorManager, AceMultiSelectionManager, ConvergenceExample, ConvergenceConfig) {
  var example = new ConvergenceExample(ConvergenceConfig ? ConvergenceConfig.DOMAIN_URL : null);

  var AceRange = ace.require('ace/range').Range;

  ///////////////////////////////////////////////////////////////////////////////
  // Global settings
  ///////////////////////////////////////////////////////////////////////////////
  var suppressEvents = false;
  var users = {};

  ///////////////////////////////////////////////////////////////////////////////
  // Connection and User List
  ///////////////////////////////////////////////////////////////////////////////
  function AceExample() {}
  AceExample.prototype = {
    connect: function() {
      this.getDomElements();

      var username = this.usernameSelect.options[this.usernameSelect.selectedIndex].value;
      example.connectWithUser(username, "password").then(function (domain) {
        this.toggleConnectionElements(true);
        this.domain = domain;
        return domain.models().open("example", "ace-demo", function () {
          return {
            "text": defaultText
          };
        });
      }.bind(this)).then(function (model) {
        this.model = model;
        // The RealTimeString that holds the text document
        this.rtString = model.valueAt("text");

        this.ace = new Ace(ace);
        this.ace.initialize(this.rtString);

        this.createListeners(this.rtString);
      }.bind(this));
    },
    getDomElements: function() {
      this.usersList = document.getElementById("sessions");
      this.usernameSelect = document.getElementById("username");
      this.connectButton = document.getElementById("connectButton");
      this.disconnectButton = document.getElementById("disconnectButton");
    },
    ///////////////////////////////////////////////////////////////////////////////
    // Two Way Binding from Ace to Convergence
    ///////////////////////////////////////////////////////////////////////////////
    createListeners: function(rtString) {
      this.registerUserListeners();
      this.registerModelListeners();

      this.handleAceEditEvent = this.handleAceEditEvent.bind(this);
      this.ace.editor.on('change', this.handleAceEditEvent);

      // create ref object
      this.referenceHandler = new ReferenceHandler(rtString, this.ace);
    },
    ///////////////////////////////////////////////////////////////////////////////
    // Incoming events
    ///////////////////////////////////////////////////////////////////////////////
    registerUserListeners: function() {
      var presenceService = this.domain.presence();
      presenceService.presence()

      this.model.connectedSessions().forEach(function (session) {
        this.addUser(session.username, session.sessionId);
      }.bind(this));

      this.model.on("session_opened", function (e) {
        this.addUser(e.username, e.sessionId);
      }.bind(this));

      this.model.on("session_closed", function (e) {
        this.removeUser(e.sessionId);
      }.bind(this));
    },
    addUser: function(username, sessionId) {
      var color = example.getConvergenceColor();
      users[sessionId] = {
        username: username,
        sessionId: sessionId,
        color: color
      };

      this.domain.identity().user(username).then(function (user) {
        var userDiv = document.createElement("div");
        userDiv.className = "session";
        userDiv.id = "user" + sessionId;

        var squareDiv = document.createElement("div");
        squareDiv.className = "userSquare";
        squareDiv.style.background = color;
        userDiv.appendChild(squareDiv);

        var usernameDiv = document.createElement("div");
        if(!user.firstName && !user.lastName) {
          usernameDiv.innerHTML = user.username;
        } else {
          usernameDiv.innerHTML = user.firstName + " " + user.lastName;
        }
        
        userDiv.appendChild(usernameDiv);

        this.usersList.appendChild(userDiv);
      }.bind(this));
    },
    removeUser: function(sessionId) {
      var user = document.getElementById("user" + sessionId);
      user.parentNode.removeChild(user);
      delete users[sessionId];
    },
    registerModelListeners: function() {
      this.rtString.on("insert", function (e) {
        this.ace.onRemoteInsert(e);
      }.bind(this));

      this.rtString.on("remove", function (e) {
        this.ace.onRemoteDelete(e);
      }.bind(this));

      this.rtString.on("value", function (e) {
        this.ace.onRemoteAdd(e);
      }.bind(this));
    },
    ///////////////////////////////////////////////////////////////////////////////
    // Outgoing events
    ///////////////////////////////////////////////////////////////////////////////
    handleAceEditEvent: function(delta) {
      if (suppressEvents) {
        return;
      }

      var pos = this.ace.document.positionToIndex(delta.start);
      switch (delta.action) {
        case "insert":
          this.rtString.insert(pos, delta.lines.join("\n"));
          break;
        case "remove":
          this.rtString.remove(pos, delta.lines.join("\n").length);
          break;
        default:
          throw new Error("unknown action: " + delta.action);
      }
    },
    toggleConnectionElements: function(isConnected) {
      this.connectButton.disabled = isConnected;
      this.disconnectButton.disabled = !isConnected;
      this.usernameSelect.disabled = isConnected;
    },
    disconnect: function() {
      this.domain.dispose();
      this.toggleConnectionElements(false);

      this.ace.editor.off('change', this.handleAceEditEvent);

      this.referenceHandler.detach();

      this.ace.reset();

      this.ace.cursorManager.removeAll();
      this.ace.selectionManager.removeAll();

      Object.getOwnPropertyNames(users).forEach(function (sessionId) {
        this.removeUser(sessionId);
      }.bind(this));
    }
  };

  ///////////////////////////////////////////////////////////////////////////////
  // Ace Editor Set Up
  ///////////////////////////////////////////////////////////////////////////////
  function Ace(ace) {
    this.editor = ace.edit("editor");
    this.editor.setReadOnly(true);
    this.session = this.editor.getSession();
    this.document = this.session.getDocument();

    this.session.setMode("ace/mode/javascript");
    this.editor.setTheme("ace/theme/monokai");

    this.cursorManager = new AceMultiCursorManager(this.session);
    this.selectionManager = new AceMultiSelectionManager(this.session);
  }
  Ace.prototype = {
    initialize: function(rtString) {
      this.editor.setReadOnly(false);

      // Initialize editor with current text.
      suppressEvents = true;
      this.document.setValue(rtString.data());
      suppressEvents = false;
    },
    onRemoteInsert: function(e) {
      suppressEvents = true;
      this.document.insert(this.document.indexToPosition(e.index), e.value);
      suppressEvents = false;
    },
    onRemoteDelete: function(e) {
      var start = this.document.indexToPosition(e.index);
      var end = this.document.indexToPosition(e.index + e.value.length);
      suppressEvents = true;
      this.document.remove(new AceRange(start.row, start.column, end.row, end.column));
      suppressEvents = false;
    },
    onRemoteAdd: function(e) {
      suppressEvents = true;
      this.document.setValue(e.value);
      suppressEvents = false;
    },
    setSelection: function(id, value) { 
      this.selectionManager.setSelection(id, this.toAceRange(value));
    },
    toAceRange: function(value) {
      if (value === null || value === undefined) {
        return null;
      }

      var start = value.start;
      var end = value.end;

      if (start > end) {
        var temp = start;
        start = end;
        end = temp;
      }

      var selectionAnchor = this.document.indexToPosition(start);
      var selectionLead = this.document.indexToPosition(end);
      return new AceRange(selectionAnchor.row, selectionAnchor.column, selectionLead.row, selectionLead.column);
    },
    reset: function() {
      this.editor.setValue("");
      this.editor.setReadOnly(true);
    }
  };

  ///////////////////////////////////////////////////////////////////////////////
  // Both publish and subscribe to cursor movements and selections
  ///////////////////////////////////////////////////////////////////////////////
  function ReferenceHandler(rtString, ace) {
    this.ace = ace;
    // Create and publish a local cursor.
    this.localCursor = rtString.indexReference("cursor");
    this.localCursor.publish();

    // Create and publish a local selection.
    this.localSelection = rtString.rangeReference("selection");
    this.localSelection.publish();

    this.initializeExistingReferences(rtString, ace);

    // Listen for remote references.
    rtString.on("reference", function (e) {
      this.handleReference(e.reference);
    }.bind(this));

    this.handleAceCursorChanged = this.handleAceCursorChanged.bind(this);
    this.handleAceSelectionChanged = this.handleAceSelectionChanged.bind(this);

    this.ace.session.selection.on('changeCursor', this.handleAceCursorChanged);
    this.ace.session.selection.on('changeSelection', this.handleAceSelectionChanged);
  }
  ReferenceHandler.prototype = {
    initializeExistingReferences: function(rtString) {
      rtString.references().forEach(function (reference) {
        if (!reference.isLocal()) {
          this.handleReference(reference);
          if (reference.key() === "cursor") {
            this.ace.cursorManager.setCursor(reference.sessionId(), reference.value());
          } else if (reference.key() === "selection" ) {
            this.ace.setSelection(reference.sessionId(), reference.value());
          }
        }
      }.bind(this));
    }, 
    ///////////////////////////////////////////////////////////////////////////////
    // Incoming events
    ///////////////////////////////////////////////////////////////////////////////
    handleReference: function(reference) {
      if (reference.key() === "cursor") {
        this.handleRemoteCursorReference(reference);
      } else if (reference.key() === "selection") {
        this.handleRemoteSelectionReference(reference);
      }
    },
    handleRemoteCursorReference: function(reference) {
      var color = users[reference.sessionId()].color;
      this.ace.cursorManager.addCursor(
        reference.sessionId(),
        reference.username(),
        color);
      
      reference.on("set", function () {
        this.ace.cursorManager.setCursor(reference.sessionId(), reference.value());
      }.bind(this));

      reference.on("cleared", function () {
        this.ace.cursorManager.clearCursor(reference.sessionId());
      }.bind(this));

      reference.on("disposed", function () {
        this.ace.cursorManager.removeCursor(reference.sessionId());
      }.bind(this));
    },
    handleRemoteSelectionReference: function(reference) {
      var color = users[reference.sessionId()].color;
      this.ace.selectionManager.addSelection(
        reference.sessionId(),
        reference.username(),
        color);

      reference.on("set", function (e) {
        this.ace.setSelection(reference.sessionId(), e.src.value());
      }.bind(this));

      reference.on("cleared", function () {
        this.ace.selectionManager.clearSelection(reference.sessionId());
      }.bind(this));

      reference.on("disposed", function () {
        this.ace.selectionManager.removeSelection(reference.sessionId());
      }.bind(this));
    },
    ///////////////////////////////////////////////////////////////////////////////
    // Outgoing events
    ///////////////////////////////////////////////////////////////////////////////
    handleAceCursorChanged: function() {
      if (!suppressEvents) {
        var pos = this.ace.document.positionToIndex(this.ace.editor.getCursorPosition());
        this.localCursor.set(pos);
      }
    },
    handleAceSelectionChanged: function() {
      if (!suppressEvents) {
        if (!this.ace.editor.selection.isEmpty()) {
          // todo ace has more complex seleciton capabilities beyond a single range.
          var start = this.ace.document.positionToIndex(this.ace.editor.selection.anchor);
          var end = this.ace.document.positionToIndex(this.ace.editor.selection.lead);
          this.localSelection.set({start: start, end: end});
        } else if (this.localSelection.isSet()) {
          this.localSelection.clear();
        }
      }
    },
    detach: function() {
      this.ace.session.selection.off('changeCursor', this.handleAceCursorChanged);
      this.ace.session.selection.off('changeSelection', this.handleAceSelectionChanged);
    }
  };

  var defaultText = `
(function(ConvergenceDomain, connectionConfig) {
  function CodeEditor() { }
  CodeEditor.prototype = {
    connect: function() {
      this.domain = new ConvergenceDomain(connectionConfig.DOMAIN_URL);
      this.domain.on("connected", function () {
        this.connectButton.disabled = true;
        this.disconnectButton.disabled = false;
        this.usernameSelect.disabled = true;
      }.bind(this));
    
      var username = this.usernameSelect.options[this.usernameSelect.selectedIndex].value;
      this.domain.authenticateWithPassword(username, "password").then(function (username) {
        return this.domain.modelService().open("example", "ace-demo");
      }.bind(this)).then(function (model) {
        this.model = model;
        // The RealTimeString that holds the text document
        this.rtString = model.valueAt("text");
      }.bind(this));
    }
  };
  return new CodeEditor();
}(ConvergenceDomain, ConvergenceConfig));`;

  return new AceExample();
}(window.ace, window.AceMultiCursorManager, window.AceMultiSelectionManager, window.ConvergenceExample, window.ConvergenceConfig));
