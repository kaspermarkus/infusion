/*
Copyright 2007-2010 University of Cambridge
Copyright 2007-2009 University of Toronto

Licensed under the Educational Community License (ECL), Version 2.0 or the New
BSD license. You may not use this file except in compliance with one these
Licenses.

You may obtain a copy of the ECL 2.0 License and BSD License at
https://source.fluidproject.org/svn/LICENSE.txt
*/

// Declare dependencies.
/*global jQuery*/

var fluid_1_2 = fluid_1_2 || {};

(function ($, fluid) {

    /** The Fluid "IoC System proper" - resolution of references and 
     * completely automated instantiation of declaratively defined
     * component trees */ 
    
    var inCreationMarker = "__CURRENTLY_IN_CREATION__";
    
    findMatchingComponent = function(that, visitor, except) {
        for (var name in that) {
            var component = that[name];
            if (component === except || !component.typeName) {continue;}
            if (visitor(component, name)) {
                return true;
            }
            findMatchingComponent(component, visitor);
         }
    };
    
    // thatStack contains an increasing list of MORE SPECIFIC thats.
    visitComponents = function(thatStack, visitor) {
        var lastDead;
        for (var i = thatStack.length - 1; i >= 0; -- i) {
            var that = thatStack[i];
            if (that.options && that.options.fireBreak) { // TODO: formalise this
               return;
            }
            if (that.typeName) {
                if (visitor(that, "")) {
                    return;
                }
            }
            if (findMatchingComponent(that, visitor, lastDead)) {
                return;
            }
            lastDead = that;
        }
    };
    
    // This is an equivalent of fluid.getPenultimate that will attempt to trigger creation of
    // components that it discovers along the EL path, if they have been defined but not yet
    // constructed. Spring, eat your heart out! Wot no SPR-2048?
    function getValueGingerly(thatStack, component, segs, ind) {
        var thisSeg = segs[ind];
        var atval = thisSeg === ""? component: fluid.model.resolvePathSegment(component, thisSeg);
        if (atval !== undefined) {
            if (atval[inCreationMarker] && atval !== thatStack[0]) {
                fluid.fail("Component of type " + 
                atval.typeName + " cannot be used for lookup of path " + segs.join(".") +
                " since it is still in creation. Please reorganise your dependencies so that they no longer contain circular references");
            }
        }
        else {
            if (component.options && component.options.components && component.options.components[thisSeg]) {
                fluid.initDependent(component, thisSeg, thatStack);
                atval = fluid.model.resolvePathSegment(component, thisSeg);
            }
      //      else {
      //          fluid.fail("Could not resolve reference segment \"" + thisSeg + 
      //          "\" within component " + JSON.stringify(component));
      //      }
        }
        if (ind === segs.length - 1) {
            return atval;
        }
        else {
            return getValueGingerly(thatStack, atval, segs, ind + 1);
        }
    };

    function makeStackFetcher(thatStack) {
        var fetcher = function(parsed) {
            var context = parsed.context;
            var foundComponent;
            visitComponents(thatStack, function(component, name) {
                if (context === name || context === component.typeName || context === component.nickName) {
                    foundComponent = component;
                    return true; // YOUR VISIT IS AT AN END!!
                }
            });
            if (!foundComponent) {
                fluid.fail("No context matched for name " + context + " from root of type " + thatStack[0].typeName);
            }
            return getValueGingerly(thatStack, foundComponent, fluid.model.parseEL(parsed.path), 0);
        };
        return fetcher;
    }
     
    function makeStackResolverOptions(thatStack) {
        return $.extend({}, fluid.defaults("fluid.resolveEnvironment"), {fetcher: makeStackFetcher(thatStack)}); 
    } 
     
    function resolveRvalue(thatStack, arg, initArgs, componentOptions) {
        var options = makeStackResolverOptions(thatStack);
        var directModel = thatStack[0].model; // TODO: this convention may not always be helpful
        
        if (arg === fluid.COMPONENT_OPTIONS) {
            arg = fluid.resolveEnvironment(componentOptions, directModel, options);
        }
        else {
            if (typeof(arg) === "string" && arg.charAt(0) === "@") { // Test cases for i) single-args, ii) composite args
                var argpos = arg.substring(1);
                arg = initArgs[argpos];
            }
            else {
                arg = fluid.resolveEnvironment(arg, directModel, options);
            }
        }
        return arg;
    }
    
    
    /** Given a concrete argument list and/or options, determine the final concrete
     * "invocation specification" which is coded by the supplied demandspec in the 
     * environment "thatStack" - the return is a package of concrete global function name
     * and argument list which is suitable to be executed directly by fluid.invokeGlobalFunction.
     */
    fluid.embodyDemands = function(thatStack, demandspec, initArgs, options) {
        var demands = $.makeArray(demandspec.args);
        if (demands.length === 0 && thatStack.length > 0) { // Guess that it is meant to be a subcomponent TODO: component grades
            demands = [fluid.COMPONENT_OPTIONS];
        }
        if (demands) {
            var args = [];
            for (var i = 0; i < demands.length; ++ i) {
                var arg = demands[i];
                if (typeof(arg) === "object" && !fluid.isMarker(arg)) {
                    var options = {};
                    for (key in arg) {
                        var ref = arg[key];
                        var rvalue = resolveRvalue(thatStack, ref, initArgs, options);
                        fluid.model.setBeanValue(options, key, rvalue);
                    }
                    args[i] = options;
                }
                else{
                    var arg = resolveRvalue(thatStack, arg, initArgs, options) || {};
                    arg.typeName = demandspec.funcName; // TODO: investigate the general sanity of this
                    args[i] = arg;
                }
            }
        }
        else {
            args = initArgs? initArgs: [];
        }

        var togo = {
            args: args,
            funcName: demandspec.funcName
        };
        return togo;
    } 
    /** Determine the appropriate demand specification held in the fluid.demands environment 
     * relative to "thatStack" for the function name(s) funcNames.
     */
    fluid.determineDemands = function (thatStack, funcNames) {
        var that = thatStack[thatStack.length - 1];
        var funcNames = $.makeArray(funcNames);
        var demandspec = fluid.locateDemands(funcNames, thatStack);
   
        if (!demandspec) {
            demandspec = {};
        }
        if (demandspec.funcName) {
            funcNames[0] = demandspec.funcName;
           /**    TODO: "redirects" disabled pending further thought
            var demandspec2 = fluid.fetchDirectDemands(funcNames[0], that.typeName);
            if (demandspec2) {
                demandspec = demandspec2; // follow just one redirect
            } **/
        }

        return {funcName: funcNames[0], args: demandspec.args};
    };
    
    fluid.resolveDemands = function (thatStack, funcNames, initArgs, options) {
        var demandspec = fluid.determineDemands(thatStack, funcNames);
        return fluid.embodyDemands(thatStack, demandspec, initArgs, options);
    };


   
    // fluid.invoke is not really supportable as a result of thatStack requirement - 
    // fluid.bindInvoker is recommended instead
    fluid.invoke = function(that, functionName, args, environment) {
        var invokeSpec = fluid.resolveDemands($.makeArray(that), functionName, args);
        return fluid.invokeGlobalFunction(invokeSpec.funcName, invokeSpec.args, environment);
    };
    
    /** Make a function which performs only "static redispatch" of the supplied function name - 
     * that is, taking only account of the contents of the "static environment". Since the static
     * environment is assumed to be constant, the dispatch of the call will be evaluated at the
     * time this call is made, as an optimisation.
     */
    
    fluid.makeFreeInvoker = function(functionName, environment) {
        var demandSpec = fluid.determineDemands([fluid.staticEnvironment], functionName);
        return function() {
            var invokeSpec = fluid.embodyDemands(fluid.staticEnvironment, demandSpec, arguments);
            return fluid.invokeGlobalFunction(invokeSpec.funcName, invokeSpec.args, environment);
        }
    };
    
    fluid.makeInvoker = function(thatStack, demandspec, functionName, environment) {
        var demandspec = demandspec || fluid.determineDemands(thatStack, functionName);
        thatStack = $.makeArray(thatStack); // take a copy of this since it will most likely go away
        return function() {
            var invokeSpec = fluid.embodyDemands(thatStack, demandspec, arguments);
            return fluid.invokeGlobalFunction(invokeSpec.funcName, invokeSpec.args, environment);
        };
    }
    
    fluid.addBoiledListener = function(thatStack, eventName, listener, namespace, predicate) {
        var thatStack = $.makeArray(thatStack);
        var topThat = thatStack[thatStack.length - 1];
        topThat.events[eventName].addListener(function(args) {
            var resolved = fluid.resolveDemands(thatStack, eventName, args);
            listener.apply(null, resolved.args);
        }, namespace, predicate);
    };
    
    var dependentStore = {};
    
    fluid.demands = function(demandingName, contextName, spec) {
        if (spec.length) {
            spec = {args: spec};
        }
        var exist = dependentStore[demandingName];
        if (!exist) {
            exist = [];
            dependentStore[demandingName] = exist;
        }
        exist.push({contexts: $.makeArray(contextName), spec: spec});
    };

    fluid.locateDemands = function(demandingNames, thatStack) {
        var searchStack = [fluid.staticEnvironment].concat(thatStack); // TODO: put in ThreadLocal "instance" too, and also accelerate lookup
        var contextNames = {};
        visitComponents(searchStack, function(component) {
            contextNames[component.typeName] = true;
        });
        var matches = [];
        for (var i = 0; i < demandingNames.length; ++ i) {
            var rec = dependentStore[demandingNames[i]] || [];
            for (var j = 0; j < rec.length; ++ j) {
                var spec = rec[j];
                var count = 0;
                for (k = 0; k < spec.contexts.length; ++ k) {
                    if (contextNames[spec.contexts[k]]) { ++ count;}
                }
                // TODO: Potentially more subtle algorithm here - also ambiguity reports  
                matches.push({count: count, spec: spec.spec}); 
            }
        }
        matches.sort(function(speca, specb) {return specb.count - speca.count;});
        return matches.length === 0? null : matches[0].spec;
    };
    
    fluid.initDependent = function(that, name, thatStack) {
        if (!that) { return; }
        var component = that.options.components[name];
        var invokeSpec = fluid.resolveDemands(thatStack, [component.type, name], [], component.options);
        var expandOptions = makeStackResolverOptions(thatStack);
        expandOptions.noValue = true;
        expandOptions.noCopy = true;
        invokeSpec.args = fluid.expander.expandLight(invokeSpec.args, expandOptions);
        var instance = fluid.initSubcomponentImpl(that, {type: invokeSpec.funcName}, invokeSpec.args);
        if (instance) { // TODO: more fallibility
            that[name] = instance;
        }
    };
        
    fluid.initDependents = function(that) {
        var options = that.options;
        that[inCreationMarker] = true;
        // push a dynamic stack of "currently resolving components" onto the current thread
        var root = fluid.threadLocal();
        var thatStack = root["fluid.initDependents"];
        if (!thatStack) {
            thatStack = [that];
            root["fluid.initDependents"] = thatStack;
        }
        else {
            thatStack.push(that);
        }
        try {
            var components = options.components || {};
            for (var name in components) {
                fluid.initDependent(that, name, thatStack);
            }
            var invokers = options.invokers || {};
            for (var name in invokers) {
                var invokerec = invokers[name];
                var funcName = typeof(invokerec) === "string"? invokerec : null;
                that[name] = fluid.makeInvoker(thatStack, funcName? null : invokerec, funcName);
            }
        }
        finally {
            thatStack.pop();
            delete that[inCreationMarker];
        }
    };
    
    // Standard Fluid component types
    
    fluid.typeTag = function(name) {
        return {
            typeName: name
        };
    };
    
    fluid.standardComponent = function(name) {
        return function(container, options) {
            var that = fluid.initView(name, container, options);
            fluid.initDependents(that);
            return that;
        };
    };
    
    fluid.littleComponent = function(name) {
        return function(options) {
            var that = fluid.initLittleComponent(name, options);
            fluid.initDependents(that);
            return that;
        };
    };
    
    fluid.makeComponents = function(components, env) {
        if (!env) {
            env = fluid.environment;
        }
        for (var name in components) {
            fluid.model.setBeanValue({}, name, 
               fluid.invokeGlobalFunction(components[name], [name], env), env);
        }
    };
    
        
    fluid.staticEnvironment = {};
    
    fluid.staticEnvironment.environmentClass = fluid.typeTag("fluid.browser");
    
    // fluid.environmentalRoot.environmentClass = fluid.typeTag("fluid.rhino");
    
    fluid.demands("fluid.threadLocal", "fluid.browser", {funcName: "fluid.singleThreadLocal"});

    var singleThreadLocal = {};
    
    fluid.singleThreadLocal = function() {
        return singleThreadLocal;
    };

    fluid.threadLocal = fluid.makeFreeInvoker("fluid.threadLocal");

    fluid.withEnvironment = function(envAdd, func) {
        var root = fluid.threadLocal();
        try {
            $.extend(root, envAdd);
            return func();
        }
        finally {
            for (var key in envAdd) {
               delete root[key];
            }
        }
    };
    
    fluid.extractEL = function(string, options) {
        if (options.ELstyle === "ALL") {
            return string;
        }
        else if (options.ELstyle.length === 1) {
            if (string.charAt(0) === options.ELstyle) {
                return string.substring(1);
            }
        }
        else if (options.ELstyle === "${}") {
            var i1 = string.indexOf("${");
            var i2 = string.lastIndexOf("}");
            if (i1 === 0 && i2 !== -1) {
                return string.substring(2, i2);
            }
        }
    };
    
    fluid.extractELWithContext = function(string, options) {
        var EL = fluid.extractEL(string, options);
        if (EL && EL.charAt(0) === "{") {
            return fluid.parseContextReference(EL, 0);
        }
        return EL? {path: EL} : EL;
    };

    /* An EL extraction utlity suitable for context expressions which occur in 
     * expanding component trees. It assumes that any context expressions refer
     * to EL paths that are to be referred to the "true (direct) model" - since
     * the context during expansion may not agree with the context during rendering.
     * It satisfies the same contract as fluid.extractEL, in that it will either return
     * an EL path, or undefined if the string value supplied cannot be interpreted
     * as an EL path with respect to the supplied options.
     */
        
    fluid.extractContextualPath = function (string, options, env) {
        var parsed = fluid.extractELWithContext(string, options);
        if (parsed) {
            if (parsed.context) {
                var fetched = env[parsed.context];
                if (typeof(fetched) !== "string") {
                    fluid.fail("Could not look up context path named " + parsed.context + " to string value");
                }
                return fluid.model.composePath(fetched, parsed.path);
            }
            else {
                return parsed.path;
            }
        }
    };

    fluid.parseContextReference = function(reference, index, delimiter) {
        var endcpos = reference.indexOf("}", index + 1);
        if (endcpos === -1) {
            fluid.fail("Malformed context reference without }");
        }
        var context = reference.substring(index + 1, endcpos);
        var endpos = delimiter? reference.indexOf(delimiter, endcpos + 1) : reference.length;
        var path = reference.substring(endcpos + 1, endpos);
        if (path.charAt(0) === ".") {
            path = path.substring(1);
        }
        return {context: context, path: path, endpos: endpos};
    };
    
    fluid.fetchContextReference = function(parsed, directModel, env) {
        var base = parsed.context? env[parsed.context] : directModel;
        if (!base) {
            return base;
        }
        return fluid.model.getBeanValue(base, parsed.path);
    };
    
    fluid.resolveContextValue = function(string, options) {
        if (options.bareContextRefs && string.charAt(0) === "{") {
            var parsed = fluid.parseContextReference(string, 0);
            return options.fetcher(parsed);        
        }
        else if (options.ELstyle && options.ELstyle !== "${}") {
            var parsed = fluid.extractELWithContext(string, options);
            if (parsed) {
                return options.fetcher(parsed);
            }
        }
        while (typeof(string) === "string") {
            var i1 = string.indexOf("${");
            var i2 = string.indexOf("}", i1 + 2);
            var all = (i1 === 0 && i2 === string.length - 1); 
            if (i1 !== -1 && i2 !== -1) {
                var parsed;
                if (string.charAt(i1 + 2) === "{") {
                    parsed = fluid.parseContextReference(string, i1 + 2, "}");
                    i2 = parsed.endpos;
                }
                else {
                    parsed = {path: string.substring(i1 + 2, i2)};
                }
                var subs = options.fetcher(parsed);
                // TODO: test case for all undefined substitution
                if (subs === undefined || subs === null) {
                    return subs;
                    }
                string = all? subs : string.substring(0, i1) + subs + string.substring(i2 + 1);
            }
            else {
                break;
            }
        }
        return string;
    };
    
    function resolveEnvironmentImpl(obj, options) {
        function recurse(arg) {
            return resolveEnvironmentImpl(arg, options);
        }
        if (typeof(obj) === "string" && !options.noValue) {
            return fluid.resolveContextValue(obj, options);
        }
        else if (fluid.isPrimitive(obj) || obj.nodeType !== undefined || obj.jquery) {
            return obj;
        }
        else if (options.filter) {
            return options.filter(obj, recurse, options);
        }
        else return (options.noCopy? fluid.each : fluid.transform)(obj, function(value, key) {
            return resolveEnvironmentImpl(value, options);
        });
    }
    
    fluid.defaults("fluid.resolveEnvironment", 
        {ELstyle:     "${}",
         bareContextRefs: true});
    
    fluid.resolveEnvironment = function(obj, directModel, userOptions) {
        directModel = directModel || {};
        var options = fluid.merge(null, {}, fluid.defaults("fluid.resolveEnvironment"), userOptions);
        if (!options.fetcher) {
            var env = fluid.threadLocal();
            options.fetcher = function(parsed) {
                return fluid.fetchContextReference(parsed, directModel, env);
            };
        }
        return resolveEnvironmentImpl(obj, options);
    };
    
    fluid.registerNamespace("fluid.expander");
    /** "light" expanders, starting with support functions for the "deferredFetcher" expander **/
  
    fluid.expander.makeDefaultFetchOptions = function (successdisposer, failid, options) {
        return $.extend(true, {dataType: "text"}, options, {
            success: function(response, environmentdisposer) {
                var json = JSON.parse(response);
                environmentdisposer(successdisposer(json));
            },
            error: function(response, textStatus) {
                fluid.log("Error fetching " + failid + ": " + textStatus);
            }
        });
    };
  
    fluid.expander.makeFetchExpander = function (options) {
        return { expander: {
            type: "fluid.expander.deferredFetcher",
            href: options.url,
            options: fluid.expander.makeDefaultFetchOptions(options.disposer, options.url, options.options),
            resourceSpecCollector: "{resourceSpecCollector}",
            fetchKey: options.fetchKey
        }};
    };
    
    fluid.expander.deferredFetcher = function(target, source) {
        var expander = source.expander;
        var spec = fluid.copy(expander);
        // fetch the "global" collector specified in the external environment to receive
        // this resourceSpec
        var collector = fluid.resolveEnvironment(expander.resourceSpecCollector);
        delete spec.type;
        delete spec.resourceSpecCollector;
        delete spec.fetchKey;
        var environmentdisposer = function(disposed) {
            $.extend(target, disposed);
        }
        // replace the callback which is there (taking 2 arguments) with one which
        // directly responds to the request, passing in the result and OUR "disposer" - 
        // which once the user has processed the response (say, parsing JSON and repackaging)
        // finally deposits it in the place of the expander in the tree to which this reference
        // has been stored at the point this expander was evaluated.
        spec.options.success = function(response) {
             expander.options.success(response, environmentdisposer);
        };
        var key = expander.fetchKey || fluid.allocateGuid();
        collector[key] = spec;
        return target;
    };
    
    fluid.expander.deferredCall = function(target, source) {
        var expander = source.expander;
        return fluid.invokeGlobalFunction(expander.func, expander.args);
    };
    
    fluid.deferredCall = fluid.expander.deferredCall; // put in top namespace for convenience
    
    // The "noexpand" expander which simply unwraps one level of expansion and ceases.
    fluid.expander.noexpand = function(target, source) {
        return $.extend(target, source.expander.tree);
    };
  
    fluid.noexpand = fluid.expander.noexpand; // TODO: check naming and namespacing
  
    fluid.expander.lightFilter = function (obj, recurse, options) {
          var togo;
          if (fluid.isArrayable(obj)) {
              togo = (options.noCopy? fluid.each: fluid.transform)(obj, function(value) {return recurse(value);});
          }
          else {
              var togo = options.noCopy? obj : {};
              for (var key in obj) {
                  var value = obj[key];
                  var expander;
                  if (key === "expander" && !(options.expandOnly && options.expandOnly[value.type])){
                      expander = fluid.getGlobalValue(value.type);  
                      if (expander) {
                          return expander.call(null, togo, obj);
                      }
                  }
                  if (key !== "expander" || !expander) {
                      togo[key] = recurse(value);
                  }
              }
          }
          return options.noCopy? obj : togo;
      };
      
    fluid.expander.expandLight = function (source, expandOptions) {
        var options = $.extend({}, expandOptions);
        options.filter = fluid.expander.lightFilter;
        return fluid.resolveEnvironment(source, options.model, options);       
    };
          
})(jQuery, fluid_1_2);
