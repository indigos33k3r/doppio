declare module 'vendor/_.js' {
  export function clone(x: any): any;
}
import underscore = module('vendor/_.js');
import gLong = module('./gLong');
import util = module('./util');
import logging = module('./logging');
//import ClassLoader = require('./ClassLoader')

export class JavaArray {
  public cls: any
  public array: any[]
  public ref: number

  constructor(rs, cls, obj) {
    this.cls = cls;
    this.ref = rs.high_oref++;
    this.array = obj;
  }

  public clone(rs): JavaArray {
    // note: we don't clone the type, because they're effectively immutable
    return new JavaArray(rs, this.cls, underscore.clone(this.array));
  }

  public get_field_from_offset(rs: any, offset: gLong): any {
    return this.array[offset.toInt()];
  }

  public set_field_from_offset(rs: any, offset: gLong, value: any): void {
    this.array[offset.toInt()] = value;
  }

  public toString(): string {
    if (this.array.length <= 10) {
      return "<" + this.cls.get_type() + " [" + this.array + "] (*" + this.ref + ")>";
    }
    return "<" + this.cls.get_type() + " of length " + this.array.length + " (*" + this.ref + ")>";
  }

  public serialize(visited: any): any {
    if (visited[this.ref]) {
      return "<*" + this.ref + ">";
    }
    visited[this.ref] = true;
    function elem_serializer(f) {
      if (!f) return f;
      if (typeof f.serialize !== "function") return f;
      return f.serialize(visited);
    }
    return {
      'type': this.cls.get_type(),
      'ref': this.ref,
      'array': this.array.map(elem_serializer)
    };
  }
}

export class JavaObject {
  public cls : any
  public fields : any
  public ref : number

  constructor(rs: any, cls: any, obj?: any) {
    this.cls = cls;
    if (obj == null) {
      obj = {};
    }
    this.ref = rs.high_oref++;
    // Use default fields as a prototype.
    this.fields = Object.create(this.cls.get_default_fields());
    for (var field in obj) {
      if (obj.hasOwnProperty(field)) {
        this.fields[field] = obj[field];
      }
    }
  }

  public clone(rs: any): JavaObject {
    // note: we don't clone the type, because they're effectively immutable
    return new JavaObject(rs, this.cls, underscore.clone(this.fields));
  }

  public set_field(rs: any, name: string, val: any): void {
    if (this.fields[name] !== undefined) {
      this.fields[name] = val;
    } else {
      rs.java_throw(this.cls.loader.get_initialized_class('Ljava/lang/NoSuchFieldError;'), name);
    }
  }

  public get_field(rs: any, name: string): any {
    if (this.fields[name] !== undefined) {
      return this.fields[name];
    }
    return rs.java_throw(this.cls.loader.get_initialized_class('Ljava/lang/NoSuchFieldError;'), name);
  }

  public get_field_from_offset(rs: any, offset: gLong): any {
    var f = this._get_field_from_offset(rs, this.cls, offset.toInt());
    if (f.field.access_flags['static']) {
      return f.cls_obj.static_get(rs, f.field.name);
    }
    return this.get_field(rs, f.cls + f.field.name);
  }

  private _get_field_from_offset(rs: any, cls: any, offset: number): any {
    var classname = cls.get_type();
    while (cls != null) {
      var jco_ref = cls.get_class_object(rs).ref;
      var f = cls.get_fields()[offset - jco_ref];
      if (f != null) {
        return {
          field: f,
          cls: cls.get_type(),
          cls_obj: cls
        };
      }
      cls = cls.get_super_class();
    }
    return rs.java_throw(this.cls.loader.get_initialized_class('Ljava/lang/NullPointerException;'), "field " + offset + " doesn't exist in class " + classname);
  }

  public set_field_from_offset(rs: any, offset: gLong, value: any): void {
    var f = this._get_field_from_offset(rs, this.cls, offset.toInt());
    if (f.field.access_flags['static']) {
      f.cls_obj.static_put(rs, f.field.name, value);
    } else {
      this.set_field(rs, f.cls + f.field.name, value);
    }
  }

  public toString(): string {
    if (this.cls.get_type() === 'Ljava/lang/String;')
      return "<" + this.cls.get_type() + " '" + (this.jvm2js_str()) + "' (*" + this.ref + ")>";
    return "<" + this.cls.get_type() + " (*" + this.ref + ")>";
  }

  public serialize(visited: any): any {
    var fields, k, v, _ref2, _ref3;

    if (this.ref in visited) {
      return "<*" + this.ref + ">";
    }
    visited[this.ref] = true;
    fields = {};
    _ref2 = this.fields;
    for (k in _ref2) {
      v = _ref2[k];
      fields[k] = (_ref3 = v != null ? typeof v.serialize === "function" ? v.serialize(visited) : void 0 : void 0) != null ? _ref3 : v;
    }
    return {
      type: this.cls.get_type(),
      ref: this.ref,
      fields: fields
    };
  }

  // Convert a Java String object into an equivalent JS one.
  public jvm2js_str(): string {
    return util.chars2js_str(this.fields['Ljava/lang/String;value'], this.fields['Ljava/lang/String;offset'], this.fields['Ljava/lang/String;count']);
  }
}

export class JavaClassObject extends JavaObject {
  constructor(rs: any, public $cls: any) {
    super(rs, rs.get_bs_cl().get_resolved_class('Ljava/lang/Class;'));
  }

  public toString() {
    return "<Class " + this.$cls.get_type() + " (*" + this.ref + ")>";
  }
}

// Each JavaClassLoaderObject is a unique ClassLoader.
export class JavaClassLoaderObject extends JavaObject {
  public $loader: any
  constructor(rs: any, cls: any) {
    super(rs, cls);
    //this.$loader = new ClassLoader.CustomClassLoader(rs.get_bs_cl(), this);
  }

  public serialize(visited: any): any {
    if (visited[this.ref]) {
      return "<*" + this.ref + ">";
    }
    visited[this.ref] = true;
    var fields = {};
    for (var k in this.fields) {
      var f = this.fields[k];
      if (!f || (typeof f.serialize !== "function"))
        fields[k] = f;
      else
        fields[k] = f.serialize(visited);
    }
    var loaded = {};
    for (var type in this.$loader.loaded_classes) {
      var vcls = this.$loader.loaded_classes[type];
      loaded[type + "(" + vcls.getLoadState() + ")"] = vcls.loader.serialize(visited);
    }
    return {
      type: this.cls.get_type(),
      ref: this.ref,
      fields: fields,
      loaded: loaded
    };
  }
}

export function thread_name(rs: any, thread: JavaObject): string {
  return util.chars2js_str(thread.get_field(rs, 'Ljava/lang/Thread;name'));
}