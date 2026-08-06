"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
// prisma/seed.ts
var client_1 = require("@prisma/client");
var bcrypt_1 = require("bcrypt");
var faker_1 = require("@faker-js/faker");
var prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var _a, adminRole, sellerRole, branchesData, createdBranches, categoriesData, createdCategories, suppliersData, createdSuppliers, passwordHash, createdAdmins, _i, createdBranches_1, branch, owner, employee, _loop_1, _b, createdBranches_2, branch;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: 
                // 1) ELIMINAR TODO EN ORDEN CORRECTO (hijos antes que padres)
                return [4 /*yield*/, prisma.stockCheck.deleteMany()];
                case 1:
                    // 1) ELIMINAR TODO EN ORDEN CORRECTO (hijos antes que padres)
                    _c.sent();
                    return [4 /*yield*/, prisma.saleItem.deleteMany()];
                case 2:
                    _c.sent();
                    return [4 /*yield*/, prisma.sale.deleteMany()];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, prisma.cashRegisterMovement.deleteMany()];
                case 4:
                    _c.sent();
                    return [4 /*yield*/, prisma.branchStock.deleteMany()];
                case 5:
                    _c.sent();
                    return [4 /*yield*/, prisma.auditLog.deleteMany()];
                case 6:
                    _c.sent();
                    return [4 /*yield*/, prisma.user.deleteMany()];
                case 7:
                    _c.sent();
                    return [4 /*yield*/, prisma.product.deleteMany()];
                case 8:
                    _c.sent();
                    return [4 /*yield*/, prisma.category.deleteMany()];
                case 9:
                    _c.sent();
                    return [4 /*yield*/, prisma.supplier.deleteMany()];
                case 10:
                    _c.sent();
                    return [4 /*yield*/, prisma.role.deleteMany()];
                case 11:
                    _c.sent();
                    return [4 /*yield*/, prisma.branch.deleteMany()
                        // 2) CREAR ROLES
                    ];
                case 12:
                    _c.sent();
                    return [4 /*yield*/, Promise.all([
                            prisma.role.create({ data: { name: 'admin' } }),
                            prisma.role.create({ data: { name: 'vendedor' } }),
                        ])
                        // 3) CREAR SUCURSALES
                    ];
                case 13:
                    _a = _c.sent(), adminRole = _a[0], sellerRole = _a[1];
                    branchesData = [
                        { name: 'Sucursal A', address: 'Av. Siempreviva 100', email: 'a@kiosco.com', phone: '1111-0000' },
                        { name: 'Sucursal B', address: 'Calle Falsa 200', email: 'b@kiosco.com', phone: '2222-0000' },
                        { name: 'Sucursal C', address: 'Ruta 3 km 15', email: 'c@kiosco.com', phone: '3333-0000' },
                    ];
                    return [4 /*yield*/, Promise.all(branchesData.map(function (b) { return prisma.branch.create({ data: b }); }))
                        // 4) CREAR CATEGORÍAS Y PROVEEDORES
                    ];
                case 14:
                    createdBranches = _c.sent();
                    categoriesData = ['Golosinas', 'Bebidas', 'Snacks'];
                    return [4 /*yield*/, Promise.all(categoriesData.map(function (name) { return prisma.category.create({ data: { name: name } }); }))];
                case 15:
                    createdCategories = _c.sent();
                    suppliersData = [
                        { name: 'Distribuidora Alfa', contact: 'alfa@proveedor.com' },
                        { name: 'Distribuidora Beta', contact: 'beta@proveedor.com' },
                    ];
                    return [4 /*yield*/, Promise.all(suppliersData.map(function (s) { return prisma.supplier.create({ data: s }); }))
                        // 5) CREAR USUARIOS (2 por sucursal: 1 dueño y 1 empleado)
                    ];
                case 16:
                    createdSuppliers = _c.sent();
                    return [4 /*yield*/, bcrypt_1.default.hash('password123', 10)];
                case 17:
                    passwordHash = _c.sent();
                    createdAdmins = [];
                    _i = 0, createdBranches_1 = createdBranches;
                    _c.label = 18;
                case 18:
                    if (!(_i < createdBranches_1.length)) return [3 /*break*/, 22];
                    branch = createdBranches_1[_i];
                    return [4 /*yield*/, prisma.user.create({
                            data: {
                                username: "owner_".concat(branch.id),
                                name: "Owner - ".concat(branch.name),
                                password: passwordHash,
                                roleId: adminRole.id,
                                branchId: branch.id,
                            },
                        })];
                case 19:
                    owner = _c.sent();
                    return [4 /*yield*/, prisma.user.create({
                            data: {
                                username: "employee_".concat(branch.id),
                                name: "Employee - ".concat(branch.name),
                                password: passwordHash,
                                roleId: sellerRole.id,
                                branchId: branch.id,
                            },
                        })];
                case 20:
                    employee = _c.sent();
                    createdAdmins.push({ id: owner.id, branchId: owner.branchId });
                    _c.label = 21;
                case 21:
                    _i++;
                    return [3 /*break*/, 18];
                case 22:
                    _loop_1 = function (branch) {
                        var branchOwner, i, randomCategory, randomSupplier, randomValue, product;
                        return __generator(this, function (_d) {
                            switch (_d.label) {
                                case 0:
                                    branchOwner = createdAdmins.find(function (u) { return u.branchId === branch.id; });
                                    i = 1;
                                    _d.label = 1;
                                case 1:
                                    if (!(i <= 20)) return [3 /*break*/, 7];
                                    randomCategory = createdCategories[Math.floor(Math.random() * createdCategories.length)];
                                    randomSupplier = createdSuppliers[Math.floor(Math.random() * createdSuppliers.length)];
                                    randomValue = faker_1.faker.number.int({ min: 1, max: 100 }) // valor aleatorio entre 1 y 100
                                    ;
                                    return [4 /*yield*/, prisma.product.create({
                                            data: {
                                                name: "".concat(faker_1.faker.commerce.productName(), " (").concat(branch.name, " ").concat(i, ")"),
                                                barcode: faker_1.faker.string.numeric(13),
                                                description: faker_1.faker.commerce.productDescription(),
                                                price: faker_1.faker.number.float({ min: 10, max: 500 }),
                                                value: randomValue, // asignar valor aleatorio
                                                categoryId: randomCategory.id,
                                                supplierId: randomSupplier.id,
                                                branchId: branch.id,
                                            },
                                        })];
                                case 2:
                                    product = _d.sent();
                                    return [4 /*yield*/, prisma.branchStock.create({
                                            data: {
                                                branchId: branch.id,
                                                productId: product.id,
                                                quantity: faker_1.faker.number.int({ min: 10, max: 20 }),
                                            },
                                        })
                                        // AUDITORÍA: Solo el dueño crea productos y stocks
                                    ];
                                case 3:
                                    _d.sent();
                                    // AUDITORÍA: Solo el dueño crea productos y stocks
                                    return [4 /*yield*/, prisma.auditLog.create({
                                            data: {
                                                userId: branchOwner.id,
                                                tableName: 'Product',
                                                recordId: product.id,
                                                actionType: 'CREATE',
                                                changes: {
                                                    name: product.name,
                                                    barcode: product.barcode,
                                                    quantity: 'initial stock created',
                                                    value: randomValue, // registrar valor
                                                },
                                                origin: 'seed-script',
                                            },
                                        })];
                                case 4:
                                    // AUDITORÍA: Solo el dueño crea productos y stocks
                                    _d.sent();
                                    return [4 /*yield*/, prisma.auditLog.create({
                                            data: {
                                                userId: branchOwner.id,
                                                tableName: 'BranchStock',
                                                recordId: product.id, // registra el id de branchStock en lugar de product.id
                                                actionType: 'CREATE',
                                                changes: {
                                                    before: null,
                                                    after: { branchId: branch.id, productId: product.id, quantity: faker_1.faker.number.int({ min: 10, max: 20 }) },
                                                },
                                                origin: 'seed-script',
                                            },
                                        })];
                                case 5:
                                    _d.sent();
                                    _d.label = 6;
                                case 6:
                                    i++;
                                    return [3 /*break*/, 1];
                                case 7: return [2 /*return*/];
                            }
                        });
                    };
                    _b = 0, createdBranches_2 = createdBranches;
                    _c.label = 23;
                case 23:
                    if (!(_b < createdBranches_2.length)) return [3 /*break*/, 26];
                    branch = createdBranches_2[_b];
                    return [5 /*yield**/, _loop_1(branch)];
                case 24:
                    _c.sent();
                    _c.label = 25;
                case 25:
                    _b++;
                    return [3 /*break*/, 23];
                case 26:
                    console.log('✅ Base de datos limpiada e inicializada con 20 productos (valor aleatorio) por sucursal, 6 usuarios y auditorías para dueños.');
                    return [2 /*return*/];
            }
        });
    });
}
main()
    .catch(function (e) {
    console.error(e);
    process.exit(1);
})
    .finally(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
