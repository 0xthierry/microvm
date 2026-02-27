import { microVmDtoSchema, type MicroVmDto, type VmRuntimeDto } from "./schema";
import { VmInvalidTransitionError } from "./errors";
import { VmStatus } from "./vm-status";

type MutableVmPatch = Partial<Pick<
  MicroVmDto,
  "name" | "vcpuCount" | "memSizeMib" | "diskSizeMib" | "sshUser"
>>;

export class MicroVM {
  constructor(private readonly dto: MicroVmDto) {}

  static fromDto(dto: MicroVmDto): MicroVM {
    return new MicroVM(microVmDtoSchema.parse(dto));
  }

  static create(dto: Omit<MicroVmDto, "status" | "updatedAt"> & {
    status?: VmStatus;
    updatedAt?: string;
  }): MicroVM {
    const status = dto.status ?? VmStatus.CREATED;
    const updatedAt = dto.updatedAt ?? dto.createdAt;
    return new MicroVM(microVmDtoSchema.parse({
      ...dto,
      status,
      updatedAt,
    }));
  }

  toDto(): MicroVmDto {
    return { ...this.dto };
  }

  get id(): string {
    return this.dto.id;
  }

  get name(): string {
    return this.dto.name;
  }

  get index(): number {
    return this.dto.index;
  }

  get status(): VmStatus {
    return this.dto.status;
  }

  get runtime(): VmRuntimeDto | undefined {
    return this.dto.runtime;
  }

  withPatch(patch: MutableVmPatch, at: string): MicroVM {
    return new MicroVM(microVmDtoSchema.parse({
      ...this.dto,
      ...patch,
      updatedAt: at,
    }));
  }

  withRuntime(runtime: VmRuntimeDto, at: string): MicroVM {
    return new MicroVM(microVmDtoSchema.parse({
      ...this.dto,
      runtime,
      updatedAt: at,
    }));
  }

  clearRuntime(at: string): MicroVM {
    return new MicroVM(microVmDtoSchema.parse({
      ...this.dto,
      runtime: undefined,
      updatedAt: at,
    }));
  }

  up(at: string): MicroVM {
    return this.transition({
      at,
      to: VmStatus.STARTING,
      allowedFrom: [VmStatus.CREATED, VmStatus.STOPPED, VmStatus.FAILED],
    });
  }

  run(at: string): MicroVM {
    return this.transition({
      at,
      to: VmStatus.RUNNING,
      allowedFrom: [VmStatus.STARTING],
    });
  }

  down(at: string): MicroVM {
    return this.transition({
      at,
      to: VmStatus.STOPPING,
      allowedFrom: [VmStatus.RUNNING, VmStatus.FAILED],
    });
  }

  stop(at: string): MicroVM {
    return this.transition({
      at,
      to: VmStatus.STOPPED,
      allowedFrom: [VmStatus.STOPPING],
    }).clearRuntime(at);
  }

  del(at: string): MicroVM {
    return this.transition({
      at,
      to: VmStatus.DELETING,
      allowedFrom: [
        VmStatus.CREATED,
        VmStatus.STARTING,
        VmStatus.RUNNING,
        VmStatus.STOPPING,
        VmStatus.STOPPED,
        VmStatus.FAILED,
      ],
    });
  }

  fail(at: string, reason: string): MicroVM {
    return new MicroVM(microVmDtoSchema.parse({
      ...this.dto,
      status: VmStatus.FAILED,
      failureReason: reason,
      updatedAt: at,
    }));
  }

  private transition(params: {
    at: string;
    to: VmStatus;
    allowedFrom: VmStatus[];
  }): MicroVM {
    if (!params.allowedFrom.includes(this.dto.status)) {
      throw new VmInvalidTransitionError({
        vmId: this.dto.id,
        from: this.dto.status,
        to: params.to,
        allowedFrom: params.allowedFrom,
      });
    }

    return new MicroVM(microVmDtoSchema.parse({
      ...this.dto,
      status: params.to,
      updatedAt: params.at,
    }));
  }
}
